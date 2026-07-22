import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDatabase, type Database } from "../packages/db/src";

const databaseUrl = process.env.POSTHOG_MIGRATION_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const warehouseUp = read("backend/db/migrations/20260720001800_posthog_warehouse_containment.sql");
const warehouseDown = read(
  "backend/db/migrations/20260720001800_posthog_warehouse_containment.down.sql",
);
const ledgerUp = read("backend/db/migrations/20260720001900_posthog_migration_ledger.sql");
const ledgerDown = read("backend/db/migrations/20260720001900_posthog_migration_ledger.down.sql");

const fixtureSql = `
  CREATE TABLE public.users (
    user_id uuid PRIMARY KEY, created_at timestamptz NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE public.applications (
    application_id uuid PRIMARY KEY, user_id uuid NOT NULL, job_id uuid NOT NULL,
    status text NOT NULL, package_status text, submission_status text,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE public.swipes (
    swipe_id uuid PRIMARY KEY, user_id uuid NOT NULL, job_id uuid NOT NULL,
    direction text NOT NULL, created_at timestamptz NOT NULL
  );
  CREATE TABLE public.analytics_events (
    event_id uuid PRIMARY KEY, user_id uuid, anonymous_id text,
    event text NOT NULL, page text, source text, created_at timestamptz NOT NULL
  );
  INSERT INTO public.users VALUES (
    '11111111-1111-4111-8111-111111111111', '2025-01-01T00:00:00Z',
    '{"billing":{"plan":"pro","is_premium":true},"demo_account":false,
      "onboarding":{"state":"complete"},"location":{"country_code":"fr"},
      "locale":"fr_FR","email":"secret@example.com","token":"never-export"}'
  );
  INSERT INTO public.applications VALUES (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    'submitted', 'ready', 'verified',
    '2025-01-02T00:00:00Z', '2025-01-02T01:00:00Z'
  );
  INSERT INTO public.swipes VALUES (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    'right', '2025-01-01T12:00:00Z'
  );
  INSERT INTO public.analytics_events VALUES (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    'anon-a', 'signup_completed', '/signup', 'frontend',
    '2025-01-01T12:00:01Z'
  );
`;

describePostgres("PostHog migrations on disposable PostgreSQL", () => {
  let sql: Database;

  beforeAll(async () => {
    sql = createDatabase(databaseUrl!, { max: 1 });
    await sql.unsafe(fixtureSql);
    await sql.unsafe(warehouseUp);
    await sql.unsafe(ledgerUp);
  });

  afterAll(async () => {
    await sql.unsafe(ledgerDown).catch(() => undefined);
    await sql.unsafe(warehouseDown).catch(() => undefined);
    await sql.end({ timeout: 5 });
  });

  test("exposes only narrow role-readable warehouse projections", async () => {
    const [identity] = await sql<
      {
        user_id: string;
        plan: string;
        is_premium: boolean;
        country_code: string;
        locale: string;
      }[]
    >`SELECT user_id, plan, is_premium, country_code, locale
      FROM analytics_public.user_identity_v1`;
    expect(identity).toEqual({
      user_id: "11111111-1111-4111-8111-111111111111",
      plan: "pro",
      is_premium: true,
      country_code: "FR",
      locale: "fr-fr",
    });
    const sensitive = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'analytics_public'
        AND column_name ~* '(^|_)(email|phone|cv|resume|token|secret|password|data)($|_)'
    `;
    expect(sensitive).toEqual([]);
    const [privileges] = await sql<
      { public_usage: boolean; role_select: boolean; public_select: boolean }[]
    >`
      SELECT
        has_schema_privilege('public', 'analytics_public', 'USAGE') AS public_usage,
        has_table_privilege(
          'posthog_warehouse_reader',
          'analytics_public.user_identity_v1',
          'SELECT'
        ) AS role_select,
        has_table_privilege(
          'public',
          'analytics_public.user_identity_v1',
          'SELECT'
        ) AS public_select
    `;
    expect(privileges).toEqual({
      public_usage: false,
      role_select: true,
      public_select: false,
    });
  });

  test("fences claims and freezes the run after post-send uncertainty", async () => {
    await sql.unsafe(`
      DO $$
      DECLARE
        v_run uuid;
        v_a public.posthog_migration_ledger%ROWTYPE;
        v_b public.posthog_migration_ledger%ROWTYPE;
        v_c public.posthog_migration_ledger%ROWTYPE;
        v_count integer;
      BEGIN
        INSERT INTO public.posthog_migration_runs (
          transform_version, source_cutoff_at, status, dry_run, started_at
        ) VALUES (
          'hirly.analytics-backfill.v1', '2025-02-01T00:00:00Z',
          'running', false, clock_timestamp()
        ) RETURNING id INTO v_run;
        INSERT INTO public.posthog_migration_ledger (
          run_id, source_event_id, source_created_at, canonical_event_name,
          transform_version, payload_hash, timestamp_quality, identity_quality,
          status, transformed_payload
        ) VALUES
        (v_run, 'event-a', '2025-01-01T00:00:00Z', 'user_signed_up',
         'hirly.analytics-backfill.v1', repeat('a', 64),
         'exact_business_timestamp', 'identified_at_ingest', 'pending', '{}'),
        (v_run, 'event-b', '2025-01-01T00:01:00Z', 'user_signed_up',
         'hirly.analytics-backfill.v1', repeat('b', 64),
         'exact_business_timestamp', 'legacy_anonymous_one_to_one', 'pending', '{}');
        SELECT * INTO STRICT v_a
        FROM public.claim_posthog_migration_rows(v_run, 'operator-a', 1, 300);
        SELECT * INTO STRICT v_b
        FROM public.claim_posthog_migration_rows(v_run, 'operator-b', 10, 300);
        IF v_a.source_event_id <> 'event-a' OR v_b.source_event_id <> 'event-b' THEN
          RAISE EXCEPTION 'atomic claim isolation failed';
        END IF;
        IF NOT public.mark_posthog_migration_send_started(
          v_run, v_a.source_event_id, v_a.lease_owner, v_a.lease_token
        ) OR NOT public.accept_posthog_migration_row(
          v_run, v_a.source_event_id, v_a.lease_owner, v_a.lease_token, '{"status":200}'
        ) THEN RAISE EXCEPTION 'send/accept transition failed'; END IF;
        IF NOT public.observe_posthog_migration_row(v_run, 'event-a', '{"seen":true}')
        THEN RAISE EXCEPTION 'observe transition failed'; END IF;
        UPDATE public.posthog_migration_ledger
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE run_id = v_run AND source_event_id = 'event-b';
        SELECT * INTO STRICT v_c
        FROM public.claim_posthog_migration_rows(v_run, 'operator-c', 1, 300);
        IF v_c.attempt_count <> 2 THEN
          RAISE EXCEPTION 'pre-send claim was not reclaimed';
        END IF;
        PERFORM public.mark_posthog_migration_send_started(
          v_run, v_c.source_event_id, v_c.lease_owner, v_c.lease_token
        );
        UPDATE public.posthog_migration_ledger
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE run_id = v_run AND source_event_id = 'event-b';
        INSERT INTO public.posthog_migration_ledger (
          run_id, source_event_id, source_created_at, canonical_event_name,
          transform_version, payload_hash, timestamp_quality, identity_quality,
          status, transformed_payload
        ) VALUES (
          v_run, 'event-c', '2025-01-01T00:02:00Z', 'user_signed_up',
          'hirly.analytics-backfill.v1', repeat('c', 64),
          'exact_business_timestamp', 'identified_at_ingest', 'pending', '{}'
        );
        SELECT count(*) INTO v_count
        FROM public.claim_posthog_migration_rows(v_run, 'operator-d', 10, 300);
        IF v_count <> 0 THEN RAISE EXCEPTION 'uncertain run continued'; END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.posthog_migration_ledger
          WHERE run_id = v_run AND source_event_id = 'event-b'
            AND status = 'uncertain'
        ) THEN RAISE EXCEPTION 'post-send expiry was replayable'; END IF;
      END $$;
    `);
    const [privilege] = await sql<{ public_execute: boolean }[]>`
      SELECT has_function_privilege(
        'public',
        'public.claim_posthog_migration_rows(uuid,text,integer,integer)',
        'EXECUTE'
      ) AS public_execute
    `;
    expect(privilege?.public_execute).toBe(false);
  });

  test("rolls back only the analytics surfaces and reapplies cleanly", async () => {
    await sql.unsafe(ledgerDown);
    await sql.unsafe(warehouseDown);
    const [rolledBack] = await sql<
      {
        runs: string | null;
        ledger: string | null;
        analytics_schema: string | null;
        users: string | null;
      }[]
    >`
      SELECT
        to_regclass('public.posthog_migration_runs')::text AS runs,
        to_regclass('public.posthog_migration_ledger')::text AS ledger,
        to_regnamespace('analytics_public')::text AS analytics_schema,
        to_regclass('public.users')::text AS users
    `;
    expect(rolledBack).toEqual({
      runs: null,
      ledger: null,
      analytics_schema: null,
      users: "users",
    });
    await sql.unsafe(warehouseUp);
    await sql.unsafe(ledgerUp);
    const [reapplied] = await sql<{ view_name: string; table_name: string }[]>`
      SELECT
        to_regclass('analytics_public.user_identity_v1')::text AS view_name,
        to_regclass('public.posthog_migration_ledger')::text AS table_name
    `;
    expect(reapplied).toEqual({
      view_name: "analytics_public.user_identity_v1",
      table_name: "posthog_migration_ledger",
    });

    await sql.unsafe(ledgerDown);
    await sql.unsafe(warehouseDown);
    await sql.unsafe(`
      CREATE ROLE posthog_warehouse_reader NOLOGIN;
      COMMENT ON ROLE posthog_warehouse_reader IS 'pre-existing-fixture-role';
      GRANT SELECT ON public.users TO posthog_warehouse_reader;
    `);
    await sql.unsafe(warehouseUp);
    await sql.unsafe(warehouseDown);
    const [preservedRole] = await sql<
      { role_exists: boolean; unrelated_select: boolean; role_comment: string }[]
    >`
      SELECT
        EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'posthog_warehouse_reader'
        ) AS role_exists,
        has_table_privilege(
          'posthog_warehouse_reader',
          'public.users',
          'SELECT'
        ) AS unrelated_select,
        (
          SELECT pg_catalog.shobj_description(oid, 'pg_authid')
          FROM pg_roles
          WHERE rolname = 'posthog_warehouse_reader'
        ) AS role_comment
    `;
    expect(preservedRole).toEqual({
      role_exists: true,
      unrelated_select: true,
      role_comment: "pre-existing-fixture-role",
    });
    await sql.unsafe(`
      REVOKE SELECT ON public.users FROM posthog_warehouse_reader;
      DROP ROLE posthog_warehouse_reader;
    `);
    await sql.unsafe(warehouseUp);
    await sql.unsafe(ledgerUp);
  });
});

if (!databaseUrl) {
  test("PostHog disposable PostgreSQL suite is opt-in", () => {
    expect(databaseUrl).toBeUndefined();
  });
}
