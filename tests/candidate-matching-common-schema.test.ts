import { describe, expect, test } from "bun:test";
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

  test("independently verifies fail-closed candidate reads and executable alias semantics", () => {
    for (const policy of [
      "candidate_projection_tombstones_reader",
      "candidate_search_profiles_reader",
      "candidate_action_projection_reader",
      "candidate_action_group_aliases_reader",
    ]) {
      const definition = inventoryUp.match(
        new RegExp(`CREATE POLICY ${policy}[^;]+;`, "s"),
      )?.[0];
      expect(definition).toContain("USING (false)");
    }
    expect(inventoryUp).not.toMatch(
      /GRANT SELECT ON public\.candidate_projection_tombstones/,
    );
    for (const functionName of [
      "read_candidate_search_profile",
      "read_candidate_actions",
      "read_candidate_action_aliases",
    ]) {
      expect(inventoryUp).toContain(
        `CREATE OR REPLACE FUNCTION public.${functionName}(p_candidate_id text)`,
      );
    }
    expect(inventoryUp).not.toContain("hirly.matching_candidate_id");
    expect(inventoryUp).toContain(
      "PRIMARY KEY (alias_group_id, canonical_group_id)",
    );
    expect(inventoryUp).toContain(
      "candidate action group aliases cannot contain cycles",
    );
    expect(inventoryUp).toContain(
      "CREATE OR REPLACE FUNCTION public.candidate_group_is_excluded",
    );
    expect(inventoryUp).toMatch(
      /WITH RECURSIVE excluded_groups[\s\S]+JOIN excluded_groups[\s\S]+alias\.alias_group_id = excluded_groups\.group_id/,
    );
    expect(inventoryDown).toContain(
      "DROP FUNCTION IF EXISTS public.candidate_group_is_excluded(text, uuid)",
    );
  });
});

const databaseUrl = process.env.CANDIDATE_MATCHING_MIGRATION_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

async function withDisposableDatabase<T>(
  callback: (sql: Database) => Promise<T>,
): Promise<T> {
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
        public.candidate_action_group_aliases,
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

describePostgres("candidate matching migrations on disposable PostgreSQL", () => {
  test.serial(
    "commits one fail-closed deletion tombstone before cleanup",
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
    30_000,
  );

  test.serial(
    "deletion propagation purges projections and rejects restored events",
    async () =>
      withDisposableDatabase(async (sql) => {
        await sql`
          INSERT INTO public.candidate_search_profiles (
            candidate_id, version, status, location_policy, freshness_window_days,
            exposure_policy_version, feature_schema_version,
            source_profile_updated_at, projected_at, source_event_id
          ) VALUES (
            'candidate-b', 4, 'active', 'country', 30, 'policy-v1',
            'matching-features.v1', clock_timestamp(), clock_timestamp(),
            '11111111-1111-4111-8111-111111111111'
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
              source_profile_updated_at, projected_at, source_event_id
            ) VALUES (
              'candidate-b', 4, 'active', 'country', 30, 'policy-v1',
              'matching-features.v1', clock_timestamp(), clock_timestamp(),
              '33333333-3333-4333-8333-333333333333'
            )
          `;
          throw new Error("expected deleted candidate projection recreation to fail");
        } catch (error) {
          expect(String(error)).toContain("cannot be recreated");
        }
      }),
    30_000,
  );

  test.serial(
    "reader direct access fails closed while scoped RPCs and aliases preserve isolation",
    async () =>
      withDisposableDatabase(async (sql) => {
        await sql.unsafe(`
          INSERT INTO public.candidate_search_profiles (
            candidate_id, version, status, location_policy, freshness_window_days,
            exposure_policy_version, feature_schema_version,
            source_profile_updated_at, projected_at, source_event_id
          ) VALUES
            ('candidate-a', 1, 'active', 'country', 30, 'policy-v1',
             'matching-features.v1', clock_timestamp(), clock_timestamp(),
             '40000000-0000-4000-8000-000000000001'),
            ('candidate-b', 1, 'active', 'country', 30, 'policy-v1',
             'matching-features.v1', clock_timestamp(), clock_timestamp(),
             '40000000-0000-4000-8000-000000000002');

          INSERT INTO public.candidate_action_projection (
            candidate_id, action_id, candidate_version, source_job_id,
            canonical_group_id, canonical_group_aliases,
            action_kind, action_at, projected_at, source_event_id
          ) VALUES
            ('candidate-a', 'action-a', 1, 'job-parent',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             ARRAY['99999999-9999-4999-8999-999999999999']::uuid[], 'dismissed',
             clock_timestamp(), clock_timestamp(),
             '40000000-0000-4000-8000-000000000003'),
            ('candidate-b', 'action-b', 1, 'job-other',
             'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ARRAY[]::uuid[], 'dismissed',
             clock_timestamp(), clock_timestamp(),
             '40000000-0000-4000-8000-000000000004');

          INSERT INTO public.candidate_action_group_aliases (
            alias_group_id, canonical_group_id, alias_kind, alias_version, source_event_id
          ) VALUES
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'split', 1,
             '40000000-0000-4000-8000-000000000005'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'split', 1,
             '40000000-0000-4000-8000-000000000005'),
            ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
             'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'merge', 2,
             '40000000-0000-4000-8000-000000000006'),
            ('99999999-9999-4999-8999-999999999999',
             '11111111-1111-4111-8111-111111111111', 'merge', 2,
             '40000000-0000-4000-8000-000000000008');
        `);

        try {
          await sql.begin(async (tx) => {
            await tx.unsafe("SET LOCAL ROLE hirly_matching_reader");
            await tx`SELECT candidate_id FROM public.candidate_search_profiles`;
          });
          throw new Error("expected direct candidate profile access to fail");
        } catch (error) {
          expect(String(error)).toContain("permission denied");
        }

        await sql.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE hirly_matching_reader");
          const profiles = await tx<{ candidate_id: string }[]>`
            SELECT candidate_id FROM public.read_candidate_search_profile('candidate-a')
          `;
          expect(profiles).toEqual([{ candidate_id: "candidate-a" }]);
          const actions = await tx<{ candidate_id: string }[]>`
            SELECT candidate_id FROM public.read_candidate_actions('candidate-a')
          `;
          expect(actions).toEqual([{ candidate_id: "candidate-a" }]);
          const aliases = await tx<{ alias_group_id: string }[]>`
            SELECT alias_group_id::text
            FROM public.read_candidate_action_aliases('candidate-a')
            ORDER BY alias_group_id
          `;
          expect(aliases.map(({ alias_group_id }) => alias_group_id)).toEqual([
            "99999999-9999-4999-8999-999999999999",
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          ]);
          const [exclusions] = await tx<
            {
              action_row_alias_descendant: boolean;
              merge_descendant: boolean;
              split_descendant: boolean;
              unrelated: boolean;
              other_candidate_group: boolean;
            }[]
          >`
            SELECT
              public.candidate_group_is_excluded(
                'candidate-a', '11111111-1111-4111-8111-111111111111'
              ) AS action_row_alias_descendant,
              public.candidate_group_is_excluded(
                'candidate-a', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
              ) AS merge_descendant,
              public.candidate_group_is_excluded(
                'candidate-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
              ) AS split_descendant,
              public.candidate_group_is_excluded(
                'candidate-a', 'ffffffff-ffff-4fff-8fff-ffffffffffff'
              ) AS unrelated,
              public.candidate_group_is_excluded(
                'candidate-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
              ) AS other_candidate_group
          `;
          expect(exclusions).toEqual({
            action_row_alias_descendant: true,
            merge_descendant: true,
            split_descendant: true,
            unrelated: false,
            other_candidate_group: false,
          });
        });

        try {
          await sql`
            INSERT INTO public.candidate_action_group_aliases (
              alias_group_id, canonical_group_id, alias_kind, alias_version, source_event_id
            ) VALUES (
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'merge', 3,
              '40000000-0000-4000-8000-000000000007'
            )
          `;
          throw new Error("expected cyclic alias insertion to fail");
        } catch (error) {
          expect(String(error)).toContain("cannot contain cycles");
        }
      }),
    30_000,
  );

  test.serial(
    "uses the common retrieval indexes and rollback preserves canonical jobs",
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

        await sql.unsafe(inventoryDown);
        await sql.unsafe(primaryDown);
        const [preserved] = await sql<
          { jobs: string; users: string; projection: string | null }[]
        >`
          SELECT
            to_regclass('public.jobs')::text AS jobs,
            to_regclass('public.users')::text AS users,
            to_regclass('public.candidate_search_profiles')::text AS projection
        `;
        expect(preserved).toEqual({ jobs: "jobs", users: "users", projection: null });
        await sql.unsafe(primaryUp);
        await sql.unsafe(inventoryUp);
      }),
    30_000,
  );
});
