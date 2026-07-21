import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
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
    expect(primaryUp).toContain(
      "entity_family IN ('profiles', 'swipes', 'applications', 'users', 'deletion')",
    );
    expect(primaryUp).toContain("operation IN ('insert', 'update', 'delete')");
    expect(inventoryUp).toContain("candidate action group alias must only advance monotonically");
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
      "candidate_action_group_aliases",
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
    expect(inventoryUp.match(/ENABLE ROW LEVEL SECURITY/g)?.length).toBe(7);
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

type SqlResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function psql(sql: string): Promise<SqlResult> {
  if (!databaseUrl) {
    throw new Error("CANDIDATE_MATCHING_MIGRATION_TEST_DATABASE_URL is required");
  }
  const sql = createDatabase(databaseUrl, { max: 1 });
  try {
    await sql.unsafe(`
      DROP TABLE IF EXISTS
        public.projection_reconciliation_tasks,
        public.job_search_documents,
        public.candidate_action_projection,
        public.candidate_search_profiles,
        public.candidate_projection_tombstones,
        public.candidate_projection_outbox,
        public.candidate_deletion_tombstones,
        public.candidate_serving_controls,
        public.candidate_event_versions,
        public.candidate_projection_runtime_controls,
        public.candidate_projection_producer_flags,
        public.matching_runtime_controls,
        public.applications,
        public.swipes,
        public.profiles,
        public.users,
        public.jobs
      CASCADE;
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
    `).then(({ exitCode, stderr }) => {
      expect(exitCode, stderr).toBe(0);
    });
    await applyFile("backend/db/migrations/20260721002300_candidate_projection_primary.sql");
    await applyFile("backend/db/migrations/20260721002400_candidate_matching_common_schema.sql");
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await applyFile("backend/db/migrations/20260721002400_candidate_matching_common_schema.down.sql").catch(
      () => undefined,
    );
    await applyFile("backend/db/migrations/20260721002300_candidate_projection_primary.down.sql").catch(
      () => undefined,
    );
    await psql(`
      DROP TABLE IF EXISTS public.applications;
      DROP TABLE IF EXISTS public.swipes;
      DROP TABLE IF EXISTS public.profiles;
      DROP TABLE IF EXISTS public.users;
      DROP TABLE IF EXISTS public.jobs;
    `).catch(() => undefined);
  });

  test("emits profile upserts only after a producer is enabled", async () => {
    await expect(
      psql(`INSERT INTO public.profiles (user_id) VALUES ('candidate-a');`),
    ).resolves.toMatchObject({ exitCode: 0 });
    let result = await psql(
      `SELECT count(*)::integer AS count FROM public.candidate_projection_outbox;`,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("0");
    result = await psql(`
      UPDATE public.candidate_projection_producer_flags
      SET enabled = true
      WHERE entity_family = 'profiles';
      UPDATE public.profiles
      SET data = '{"role":"engineer"}'
      WHERE user_id = 'candidate-a';
      SELECT candidate_version || '|' || entity_family || '|' || entity_id || '|' || operation
      FROM public.candidate_projection_outbox
      WHERE candidate_id = 'candidate-a'
      ORDER BY created_at;
      SELECT count(*)::integer
      FROM information_schema.columns
      WHERE table_name = 'candidate_projection_outbox' AND column_name = 'payload';
    `);
    await sql.unsafe(primaryUp);
    await sql.unsafe(inventoryUp);
    return await callback(sql);
  } finally {
    await sql.unsafe(inventoryDown).catch(() => undefined);
    await sql.unsafe(primaryDown).catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

  test("fails closed on direct user delete and keeps the RPC tombstone dominant", async () => {
    await expect(
      psql(`INSERT INTO public.users (user_id, email) VALUES ('candidate-b', 'b@example.com');`),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      psql(`
        UPDATE public.candidate_projection_producer_flags
        SET enabled = true
        WHERE entity_family = 'users';
      `),
    ).resolves.toMatchObject({ exitCode: 0 });
    const directDelete = await psql(
      `DELETE FROM public.users WHERE user_id = 'candidate-b';`,
    );
    expect(directDelete.exitCode).not.toBe(0);
    expect(directDelete.stderr).toContain("user deletion must use begin_candidate_deletion first");

  test.serial(
    "commits one fail-closed deletion tombstone before cleanup",
    { timeout: 30_000 },
    async () =>
      withDisposableDatabase(async (sql) => {
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
        expect(state).toEqual({ disabled: true, deletion_events: 1, total_events: 1 });
        try {
          await sql`DELETE FROM public.candidate_deletion_tombstones WHERE candidate_id = 'candidate-a'`;
          throw new Error("expected candidate deletion tombstones delete to fail");
        } catch (error) {
          expect(String(error)).toContain("cannot be deleted");
        }
      }),
  );

  test.serial(
    "deletion propagation purges projections and rejects restored events",
    { timeout: 30_000 },
    async () =>
      withDisposableDatabase(async (sql) => {
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
        try {
          await sql`
            INSERT INTO public.candidate_search_profiles (
              candidate_id, version, status, location_policy, freshness_window_days,
              exposure_policy_version, feature_schema_version,
              source_profile_updated_at, source_event_id
            ) VALUES (
              'candidate-b', 4, 'active', 'country', 30, 'policy-v1', 1,
              clock_timestamp(), '33333333-3333-4333-8333-333333333333'
            )
          `;
          throw new Error("expected deleted candidate projection recreation to fail");
        } catch (error) {
          expect(String(error)).toContain("cannot be recreated");
        }
      }),
  );

  test.serial(
    "uses the common retrieval indexes and rollback preserves canonical jobs",
    { timeout: 30_000 },
    async () =>
      withDisposableDatabase(async (sql) => {
        const [planRow] = await sql.begin(async (tx) => {
          await tx`SET LOCAL enable_seqscan = off`;
          return await tx<{ "QUERY PLAN": string }[]>`
            EXPLAIN (FORMAT TEXT)
            SELECT canonical_group_id
            FROM public.job_search_documents
            WHERE lifecycle_status = 'active'
              AND source_eligible AND policy_eligible
              AND country_codes && ARRAY['FR']::text[]
              AND role_family_codes && ARRAY['software-engineering']::text[]
          `;
        });
        expect(planRow?.["QUERY PLAN"]).toMatch(
          /job_search_documents_(features|retrieval)_idx/,
        );

  test("uses the common retrieval indexes and rollback preserves canonical jobs", async () => {
    const plan = await psql(`
      BEGIN;
      SET LOCAL enable_seqscan = off;
      EXPLAIN (FORMAT TEXT)
      SELECT canonical_group_id
      FROM public.job_search_documents
      WHERE lifecycle_status = 'active'
        AND source_eligible AND policy_eligible
        AND country_codes && ARRAY['FR']::text[]
        AND role_family_codes && ARRAY['software-engineering']::text[];
      ROLLBACK;
    `);
    expect(plan.exitCode, plan.stderr).toBe(0);
    expect(plan.stdout).toMatch(/job_search_documents_(features|retrieval)_idx/);

    await applyFile("backend/db/migrations/20260721002400_candidate_matching_common_schema.down.sql");
    await applyFile("backend/db/migrations/20260721002300_candidate_projection_primary.down.sql");
    const preserved = await psql(`
      SELECT
        to_regclass('public.jobs')::text AS jobs,
        to_regclass('public.users')::text AS users,
        to_regclass('public.candidate_search_profiles')::text AS projection;
    `);
    expect(preserved.exitCode, preserved.stderr).toBe(0);
    expect(preserved.stdout).toContain("jobs");
    expect(preserved.stdout).toContain("users");
    expect(preserved.stdout).toContain("|");
    await applyFile("backend/db/migrations/20260721002300_candidate_projection_primary.sql");
    await applyFile("backend/db/migrations/20260721002400_candidate_matching_common_schema.sql");
  });
});
