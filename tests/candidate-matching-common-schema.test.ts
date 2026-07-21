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
  const proc = Bun.spawn(
    [
      "psql",
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-q",
      "-c",
      sql,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function applyFile(relativePath: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error("CANDIDATE_MATCHING_MIGRATION_TEST_DATABASE_URL is required");
  }
  const proc = Bun.spawn(
    [
      "psql",
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-f",
      `${repoRoot}/${relativePath}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to apply ${relativePath}: ${stderr.trim()}`);
  }
}

describePostgres("candidate matching migrations on disposable PostgreSQL", () => {
  beforeAll(async () => {
    await psql(`
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
    expect(result.exitCode, result.stderr).toBe(0);
    const [eventLine, payloadLine] = result.stdout.split("\n").filter(Boolean);
    expect(eventLine).toBe("1|profiles|candidate-a|update");
    expect(payloadLine).toBe("0");
  });

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

    const tombstone = await psql(`
      SELECT (public.begin_candidate_deletion('candidate-b', 'delete:candidate-b')).deletion_version;
      DELETE FROM public.users WHERE user_id = 'candidate-b';
      SELECT deletion_version || '|' || idempotency_key || '|' || serving_disabled
      FROM public.candidate_deletion_tombstones
      WHERE candidate_id = 'candidate-b';
      SELECT count(*)::integer
      FROM public.candidate_projection_outbox
      WHERE candidate_id = 'candidate-b';
    `);
    expect(tombstone.exitCode, tombstone.stderr).toBe(0);
    const [tombstoneVersion, tombstoneLine, outboxCount] = tombstone.stdout
      .split("\n")
      .filter(Boolean);
    expect(tombstoneVersion).toBe("1");
    expect(tombstoneLine).toBe("1|delete:candidate-b|t");
    expect(outboxCount).toBe("1");
    const replay = await psql(`
      SELECT (public.begin_candidate_deletion('candidate-b', 'delete:candidate-b-replay')).deletion_version;
      SELECT deletion_version || '|' || idempotency_key
      FROM public.candidate_projection_tombstones
      WHERE candidate_id = 'candidate-b';
    `);
    expect(replay.exitCode, replay.stderr).toBe(0);
    const [replayVersion, replayLine] = replay.stdout.split("\n").filter(Boolean);
    expect(replayVersion).toBe("1");
    expect(replayLine).toBe("1|delete:candidate-b");
  });

  test("deletion propagation purges projections and accepts higher-version replay", async () => {
    await expect(
      psql(`
        INSERT INTO public.candidate_search_profiles (
          candidate_id, version, status, location_policy, freshness_window_days,
          exposure_policy_version, feature_schema_version,
          source_profile_updated_at, source_event_id
        ) VALUES (
          'candidate-c', 4, 'active', 'country', 30, 'policy-v1', 1,
          clock_timestamp(), '11111111-1111-4111-8111-111111111111'
        );
      `),
    ).resolves.toMatchObject({ exitCode: 0 });
    let replay = await psql(`
      SELECT public.apply_candidate_projection_tombstone(
        'candidate-c', 5, '22222222-2222-4222-8222-222222222222', clock_timestamp()
      ) AS applied;
      SELECT count(*)::integer
      FROM public.candidate_search_profiles
      WHERE candidate_id = 'candidate-c';
    `);
    expect(replay.exitCode, replay.stderr).toBe(0);
    let [appliedLine, remainingLine] = replay.stdout.split("\n").filter(Boolean);
    expect(appliedLine).toBe("t");
    expect(remainingLine).toBe("0");
    replay = await psql(`
      SELECT public.apply_candidate_projection_tombstone(
        'candidate-c', 6, '33333333-3333-4333-8333-333333333333', clock_timestamp()
      ) AS applied;
      SELECT deletion_version || '|' || source_event_id
      FROM public.candidate_projection_tombstones
      WHERE candidate_id = 'candidate-c';
    `);
    expect(replay.exitCode, replay.stderr).toBe(0);
    [appliedLine, remainingLine] = replay.stdout.split("\n").filter(Boolean);
    expect(appliedLine).toBe("t");
    expect(remainingLine).toBe(
      "6|33333333-3333-4333-8333-333333333333",
    );
  });

  test("supports action-group alias merge and split replay semantics", async () => {
    const alias = await psql(`
      INSERT INTO public.candidate_action_group_aliases (
        alias_group_id, canonical_group_id, alias_kind, alias_version, source_event_id
      ) VALUES (
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
        'merge', 1, '66666666-6666-4666-8666-666666666666'
      );
      UPDATE public.candidate_action_group_aliases
      SET canonical_group_id = '77777777-7777-4777-8777-777777777777',
          alias_kind = 'split',
          alias_version = 2,
          source_event_id = '88888888-8888-4888-8888-888888888888'
      WHERE alias_group_id = '44444444-4444-4444-8444-444444444444';
      SELECT alias_kind || '|' || alias_version || '|' || canonical_group_id
      FROM public.candidate_action_group_aliases
      WHERE alias_group_id = '44444444-4444-4444-8444-444444444444';
    `);
    expect(alias.exitCode, alias.stderr).toBe(0);
    const aliasLine = alias.stdout.split("\n").filter(Boolean).pop();
    expect(aliasLine).toBe(
      "split|2|77777777-7777-4777-8777-777777777777",
    );
  });

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
