import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDatabase, type Database } from "../packages/db/src";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const primaryUp = read(
  "backend/db/migrations/20260721002300_candidate_projection_primary.sql",
);
const primaryDown = read(
  "backend/db/migrations/20260721002300_candidate_projection_primary.down.sql",
);
const inventoryUp = read(
  "backend/db/migrations/20260721002400_candidate_matching_common_schema.sql",
);
const inventoryDown = read(
  "backend/db/migrations/20260721002400_candidate_matching_common_schema.down.sql",
);

describe("candidate matching common migration contracts", () => {
  test("keeps every activation control disabled by default", () => {
    expect(primaryUp).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(primaryUp).toContain("relay_enabled boolean NOT NULL DEFAULT false");
    expect(inventoryUp).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(primaryUp).toContain(
      "IF NOT (SELECT relay_enabled FROM public.candidate_projection_runtime_controls",
    );
  });

  test("uses primary row triggers and a transactional deletion RPC", () => {
    for (const table of ["profiles", "swipes", "applications", "users"]) {
      expect(primaryUp).toContain(
        `AFTER INSERT OR UPDATE OR DELETE ON public.${table}`,
      );
    }
    expect(primaryUp).toContain("public.candidate_projection_next_version");
    expect(primaryUp).toContain("public.begin_candidate_deletion");
    expect(primaryUp).toContain("candidate deletion tombstones cannot be deleted");
    expect(primaryUp).not.toMatch(/payload\s+jsonb/i);
  });

  test("contains only common purpose-limited projection tables", () => {
    const createdTables = [...inventoryUp.matchAll(/CREATE TABLE public\.(\w+)/g)].map(
      ([, table]) => table,
    );
    expect(createdTables).toEqual([
      "matching_runtime_controls",
      "candidate_projection_tombstones",
      "candidate_search_profiles",
      "candidate_action_projection",
      "job_search_documents",
      "projection_reconciliation_tasks",
    ]);
    expect(inventoryUp).not.toMatch(
      /CREATE TABLE public\.(candidate_match_generations|candidate_job_matches|match_fanout|generation_tasks)/,
    );
    expect(inventoryUp).not.toMatch(/\b(cv|email|phone|cover_letter|resume_text)\b/i);
  });

  test("provides RLS, narrow service permissions, rollback, and plan proof", () => {
    expect(primaryUp.match(/ENABLE ROW LEVEL SECURITY/g)?.length).toBe(6);
    expect(inventoryUp.match(/ENABLE ROW LEVEL SECURITY/g)?.length).toBe(6);
    expect(inventoryUp).not.toMatch(/GRANT .* ON public\.jobs\b/i);
    expect(primaryDown).toContain("DROP TABLE IF EXISTS public.candidate_projection_outbox");
    expect(inventoryDown).toContain("DROP TABLE IF EXISTS public.job_search_documents");
    const proof = read("artifacts/candidate-matching/pr1-common-query-plan.sql");
    expect(proof).toContain("generate_series(1, 300000)");
    expect(proof).toContain("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)");
    expect(proof).toContain("ROLLBACK;");
  });
});

const databaseUrl = process.env.CANDIDATE_MATCHING_MIGRATION_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("candidate matching migrations on disposable PostgreSQL", () => {
  let sql: Database;

  beforeAll(async () => {
    sql = createDatabase(databaseUrl!, { max: 1 });
    await sql.unsafe(`
      CREATE TABLE public.users (
        user_id text PRIMARY KEY, email text, data jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE public.profiles (
        user_id text PRIMARY KEY, data jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE public.swipes (
        user_id text NOT NULL, job_id text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (user_id, job_id)
      );
      CREATE TABLE public.applications (
        application_id text PRIMARY KEY, user_id text NOT NULL, job_id text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE public.jobs (
        job_id text PRIMARY KEY, data jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      INSERT INTO public.jobs VALUES ('canonical-job-preserved', '{}');
    `);
    await sql.unsafe(primaryUp);
    await sql.unsafe(inventoryUp);
  });

  afterAll(async () => {
    await sql.unsafe(inventoryDown).catch(() => undefined);
    await sql.unsafe(primaryDown).catch(() => undefined);
    await sql.unsafe(`
      DROP TABLE IF EXISTS public.applications;
      DROP TABLE IF EXISTS public.swipes;
      DROP TABLE IF EXISTS public.profiles;
      DROP TABLE IF EXISTS public.users;
      DROP TABLE IF EXISTS public.jobs;
    `).catch(() => undefined);
    await sql.end({ timeout: 5 });
  });

  test("emits monotonic opaque events only after a producer is enabled", async () => {
    await sql`INSERT INTO public.profiles (user_id) VALUES ('candidate-a')`;
    let [count] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM public.candidate_projection_outbox
    `;
    expect(count?.count).toBe(0);
    await sql`
      UPDATE public.candidate_projection_producer_flags
      SET enabled = true WHERE entity_family = 'profiles'
    `;
    await sql`UPDATE public.profiles SET data = '{"role":"engineer"}' WHERE user_id = 'candidate-a'`;
    const events = await sql<
      { candidate_version: number; entity_family: string; entity_id: string }[]
    >`
      SELECT candidate_version, entity_family, entity_id
      FROM public.candidate_projection_outbox
      WHERE candidate_id = 'candidate-a'
    `;
    expect(events).toEqual([
      { candidate_version: 1, entity_family: "profiles", entity_id: "candidate-a" },
    ]);
    [count] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM information_schema.columns
      WHERE table_name = 'candidate_projection_outbox' AND column_name = 'payload'
    `;
    expect(count?.count).toBe(0);
  });

  test("commits one fail-closed deletion tombstone before cleanup", async () => {
    const [first] = await sql<{ deletion_version: number }[]>`
      SELECT deletion_version
      FROM public.begin_candidate_deletion('candidate-a', 'delete:candidate-a')
    `;
    const [retry] = await sql<{ deletion_version: number }[]>`
      SELECT deletion_version
      FROM public.begin_candidate_deletion('candidate-a', 'delete:candidate-a')
    `;
    expect(retry?.deletion_version).toBe(first?.deletion_version);
    await sql`DELETE FROM public.profiles WHERE user_id = 'candidate-a'`;
    const [state] = await sql<
      { disabled: boolean; deletion_events: number; total_events: number }[]
    >`
      SELECT
        control.serving_disabled AS disabled,
        count(*) FILTER (WHERE event.entity_family = 'deletion')::integer AS deletion_events,
        count(*)::integer AS total_events
      FROM public.candidate_serving_controls AS control
      JOIN public.candidate_projection_outbox AS event
        ON event.candidate_id = control.candidate_id
      WHERE control.candidate_id = 'candidate-a'
      GROUP BY control.serving_disabled
    `;
    expect(state).toEqual({ disabled: true, deletion_events: 1, total_events: 2 });
    await expect(
      sql`DELETE FROM public.candidate_deletion_tombstones WHERE candidate_id = 'candidate-a'`,
    ).rejects.toThrow("cannot be deleted");
  });

  test("deletion propagation purges projections and rejects restored events", async () => {
    await sql`
      INSERT INTO public.candidate_search_profiles (
        candidate_id, version, status, location_policy, freshness_window_days,
        exposure_policy_version, feature_schema_version,
        source_profile_updated_at, source_event_id
      ) VALUES (
        'candidate-b', 4, 'active', 'country', 30, 'policy-v1', 1,
        clock_timestamp(), '11111111-1111-4111-8111-111111111111'
      )
    `;
    const [applied] = await sql<{ applied: boolean }[]>`
      SELECT public.apply_candidate_projection_tombstone(
        'candidate-b', 5, '22222222-2222-4222-8222-222222222222', clock_timestamp()
      ) AS applied
    `;
    expect(applied?.applied).toBe(true);
    const [remaining] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM public.candidate_search_profiles
      WHERE candidate_id = 'candidate-b'
    `;
    expect(remaining?.count).toBe(0);
    await expect(sql`
      INSERT INTO public.candidate_search_profiles (
        candidate_id, version, status, location_policy, freshness_window_days,
        exposure_policy_version, feature_schema_version,
        source_profile_updated_at, source_event_id
      ) VALUES (
        'candidate-b', 4, 'active', 'country', 30, 'policy-v1', 1,
        clock_timestamp(), '33333333-3333-4333-8333-333333333333'
      )
    `).rejects.toThrow("cannot be recreated");
  });

  test("uses the common retrieval indexes and rollback preserves canonical jobs", async () => {
    const [plan] = await sql<{ plan: string }[]>`
      SET LOCAL enable_seqscan = off;
      EXPLAIN (FORMAT TEXT)
      SELECT canonical_group_id
      FROM public.job_search_documents
      WHERE lifecycle_status = 'active'
        AND source_eligible AND policy_eligible
        AND country_codes && ARRAY['FR']::text[]
        AND role_family_codes && ARRAY['software-engineering']::text[]
    `;
    expect(plan?.plan).toMatch(/job_search_documents_(features|retrieval)_idx/);

    await sql.unsafe(inventoryDown);
    await sql.unsafe(primaryDown);
    const [preserved] = await sql<{ jobs: string; users: string; projection: string | null }[]>`
      SELECT
        to_regclass('public.jobs')::text AS jobs,
        to_regclass('public.users')::text AS users,
        to_regclass('public.candidate_search_profiles')::text AS projection
    `;
    expect(preserved).toEqual({ jobs: "jobs", users: "users", projection: null });
    await sql.unsafe(primaryUp);
    await sql.unsafe(inventoryUp);
  });
});
