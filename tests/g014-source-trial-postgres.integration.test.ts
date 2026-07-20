import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const databaseUrl =
  process.env.G014_TEST_DATABASE_URL ?? process.env.G002_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(args: string[]): Promise<string> {
  if (!databaseUrl) throw new Error("G014_TEST_DATABASE_URL is required");
  const process = Bun.spawn(
    ["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout.trim();
}

async function apply(path: string): Promise<void> {
  await psql(["-q", "-f", join(repoRoot, path)]);
}

describe("G014 real-Postgres source trial isolation", () => {
  runIntegration(
    "allows bounded evidence RPCs while denying every canonical mutation surface",
    async () => {
      await apply("backend/db/jobs_inventory_schema.sql");
      for (const migration of [
        "20260720000100_typescript_worker_foundation.sql",
        "20260720000200_bun_worker_runtime.sql",
        "20260720000300_job_ingestion_run_ledger.sql",
        "20260720000400_job_supply_observability.sql",
        "20260720000500_job_dedup_linkage.sql",
        "20260720000600_typescript_ingestion_source_boundary.sql",
        "20260720000700_provider_ownership_epochs.sql",
        "20260720000800_ats_tenant_source_registration.sql",
        "20260720000900_ats_registration_activation_hardening.sql",
        "20260720001000_open_source_policy_evidence.sql",
        "20260720001100_source_trial_foundation.sql",
      ]) {
        await apply(`backend/db/migrations/${migration}`);
      }

      const result = await psql(["-A", "-t", "-q", "-c", `
        BEGIN;

        CREATE TABLE IF NOT EXISTS public.applications (
          application_id text PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS public.fulfillment_queue (
          queue_id text PRIMARY KEY
        );

        INSERT INTO public.provider_registry (
          provider, access_method, authorization_status, enabled,
          writer_runtime, rate_limit_config
        ) VALUES (
          'greenhouse', 'trial-only', 'unverified', false, 'none',
          '{"requestsPerMinute":1,"concurrency":1}'::jsonb
        )
        ON CONFLICT (provider) DO UPDATE
        SET enabled = false, writer_runtime = 'none',
            authorization_status = 'unverified';

        INSERT INTO public.career_sources (
          provider, source_key, tenant_key, company_name, country_codes,
          base_url, access_type, discovery_state, enabled, transport_enabled,
          incremental_enabled, backfill_enabled
        ) VALUES (
          'greenhouse', 'greenhouse:g014-foundation', 'g014-foundation',
          'G014 Fixture', ARRAY['FR'],
          'https://boards.greenhouse.io/g014-foundation',
          'tenant_feed', 'validated', false, false, false, false
        );
        SELECT set_config(
          'g014.source_id',
          (
            SELECT id::text FROM public.career_sources
            WHERE provider = 'greenhouse'
              AND source_key = 'greenhouse:g014-foundation'
          ),
          true
        );

        INSERT INTO public.source_policy_evidence (
          source_key, evidence_key, evidence_type, evidence_reference,
          artifact_path, artifact_sha256, captured_at, qualification_status,
          production_eligible, claim_scope
        ) VALUES (
          'greenhouse:g014-foundation', 'g014-approved-fixture',
          'written_permission', 'g014-test-approval',
          'tests/fixtures/g014-policy.json',
          repeat('a', 64), clock_timestamp(), 'requires_legal_review', false,
          '{"trialOnly":true}'::jsonb
        );
        SELECT set_config(
          'g014.evidence_id',
          (
            SELECT id::text FROM public.source_policy_evidence
            WHERE source_key = 'greenhouse:g014-foundation'
              AND evidence_key = 'g014-approved-fixture'
          ),
          true
        );

        DO $mismatch$
        BEGIN
          BEGIN
            INSERT INTO public.source_trial_policies (
              source_id, provider, tenant_key, policy_evidence_id,
              permitted_access_method, environment, starts_at, expires_at,
              max_total_runs, max_pages_per_run, max_candidates_per_run,
              max_bytes_per_run, trial_enabled, approved_by, approval_reference
            ) VALUES (
              current_setting('g014.source_id')::uuid,
              'greenhouse', 'g014-foundation',
              current_setting('g014.evidence_id')::uuid,
              'partner_feed', 'staging',
              clock_timestamp() - interval '1 minute',
              clock_timestamp() + interval '1 hour',
              1, 1, 1, 4096, true, 'g014-test', 'g014-fixture'
            );
            RAISE EXCEPTION 'mismatched access method unexpectedly accepted';
          EXCEPTION WHEN check_violation THEN NULL;
          END;
        END
        $mismatch$;

        INSERT INTO public.source_trial_policies (
          source_id, provider, tenant_key, policy_evidence_id,
          permitted_access_method, environment, starts_at, expires_at,
          max_total_runs, max_pages_per_run, max_candidates_per_run,
          max_bytes_per_run, trial_enabled, approved_by, approval_reference
        ) VALUES (
          current_setting('g014.source_id')::uuid,
          'greenhouse', 'g014-foundation',
          current_setting('g014.evidence_id')::uuid,
          'tenant_feed', 'test',
          clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '1 hour',
          1, 1, 1, 4096, true, 'g014-test', 'g014-fixture'
        );

        SET LOCAL ROLE hirly_source_trial_worker;

        DO $budget$
        BEGIN
          BEGIN
            PERFORM worker_private.begin_source_trial(jsonb_build_object(
              'schemaVersion', 'hirly.source-trial-manifest.v1',
              'trialKey', 'greenhouse:g014:over-budget:' ||
                gen_random_uuid()::text,
              'sourceId', current_setting('g014.source_id'),
              'provider', 'greenhouse',
              'tenantKey', 'g014-foundation',
              'environment', 'test',
              'countryCodes', jsonb_build_array('FR'),
              'policyEvidenceId', current_setting('g014.evidence_id'),
              'requestedAt', to_jsonb(clock_timestamp()),
              'expiresAt', to_jsonb(clock_timestamp() + interval '30 minutes'),
              'budget', jsonb_build_object(
                'maxPages', 2, 'maxCandidates', 1, 'maxBytes', 4096
              )
            ));
            RAISE EXCEPTION 'over-budget trial unexpectedly accepted';
          EXCEPTION WHEN insufficient_privilege THEN NULL;
          END;
        END
        $budget$;

        SELECT set_config(
          'g014.run_id',
          worker_private.begin_source_trial(jsonb_build_object(
            'schemaVersion', 'hirly.source-trial-manifest.v1',
            'trialKey', 'greenhouse:g014:' || gen_random_uuid()::text,
            'sourceId', current_setting('g014.source_id'),
            'provider', 'greenhouse',
            'tenantKey', 'g014-foundation',
            'environment', 'test',
            'countryCodes', jsonb_build_array('FR'),
            'policyEvidenceId', current_setting('g014.evidence_id'),
            'requestedAt', to_jsonb(clock_timestamp()),
            'expiresAt', to_jsonb(clock_timestamp() + interval '30 minutes'),
            'budget', jsonb_build_object(
              'maxPages', 1, 'maxCandidates', 1, 'maxBytes', 4096
            )
          ))::text,
          true
        );

        SELECT set_config(
          'g014.page_id',
          worker_private.record_source_trial_page(
            current_setting('g014.run_id')::uuid,
            1,
            clock_timestamp(),
            '{"items":[{"id":"job-1"}]}'::jsonb
          )::text,
          true
        );

        SELECT worker_private.record_source_trial_candidate(
          current_setting('g014.run_id')::uuid,
          current_setting('g014.page_id')::uuid,
          'job-1',
          '{"externalId":"job-1","title":"Trial Engineer"}'::jsonb
        );

        SELECT worker_private.record_source_trial_scorecard(
          current_setting('g014.run_id')::uuid,
          'trial-result.v1',
          jsonb_build_object(
            'schemaVersion', 'hirly.source-trial-result.v1',
            'runId', current_setting('g014.run_id'),
            'trialKey', 'g014',
            'status', 'completed',
            'startedAt', to_jsonb(clock_timestamp()),
            'finishedAt', to_jsonb(clock_timestamp()),
            'pagesFetched', 1,
            'candidatesObserved', 1,
            'bytesStored', 26,
            'stopReason', NULL
          )
        );

        RESET ROLE;

        DO $immutable$
        BEGIN
          BEGIN
            UPDATE public.source_trial_runs
            SET trial_key = trial_key || ':changed'
            WHERE id = current_setting('g014.run_id')::uuid;
            RAISE EXCEPTION 'immutable trial run unexpectedly changed';
          EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
          END;
        END
        $immutable$;

        SELECT jsonb_build_object(
          'runs', (SELECT count(*) FROM public.source_trial_runs),
          'pages', (SELECT count(*) FROM public.source_trial_pages),
          'candidates', (SELECT count(*) FROM public.source_trial_candidates),
          'scorecards', (SELECT count(*) FROM public.source_trial_scorecards),
          'canonicalPrivileges', (
            SELECT bool_or(
              has_table_privilege(
                'hirly_source_trial_worker', table_name,
                'INSERT,UPDATE,DELETE,TRUNCATE'
              )
            )
            FROM unnest(ARRAY[
              'public.jobs',
              'public.job_occurrences',
              'public.canonical_job_groups',
              'public.provider_registry',
              'public.career_sources',
              'public.worker_schedules',
              'public.worker_tasks',
              'public.applications',
              'public.fulfillment_queue'
            ]) AS table_name
          ),
          'canonicalRpcPrivileges', (
            SELECT bool_or(has_function_privilege(
              'hirly_source_trial_worker', function_name, 'EXECUTE'
            ))
            FROM unnest(ARRAY[
              'worker_private.write_job_and_complete(uuid,uuid,bigint,text,jsonb)',
              'worker_private.set_provider_writer(text,text)',
              'worker_private.set_schedule_enabled(text,boolean,timestamp with time zone)'
            ]) AS function_name
          ),
          'executableRpcs', (
            SELECT jsonb_agg(routine_name ORDER BY routine_name)
            FROM information_schema.role_routine_grants
            WHERE grantee = 'hirly_source_trial_worker'
          ),
          'providerEnabled', (
            SELECT enabled FROM public.provider_registry
            WHERE provider = 'greenhouse'
          ),
          'sourceEnabled', (
            SELECT enabled OR transport_enabled OR incremental_enabled
              OR backfill_enabled
            FROM public.career_sources
            WHERE id = current_setting('g014.source_id')::uuid
          ),
          'productionEligible', (
            SELECT production_eligible
            FROM public.source_policy_evidence
            WHERE id = current_setting('g014.evidence_id')::uuid
          )
        );

        ROLLBACK;
      `]);

      const proof = JSON.parse(result.split("\n").at(-1) ?? "{}");
      expect(proof).toEqual({
        runs: 1,
        pages: 1,
        candidates: 1,
        scorecards: 1,
        canonicalPrivileges: false,
        canonicalRpcPrivileges: false,
        executableRpcs: [
          "begin_source_trial",
          "record_source_trial_candidate",
          "record_source_trial_page",
          "record_source_trial_scorecard",
        ],
        providerEnabled: false,
        sourceEnabled: false,
        productionEligible: false,
      });
    },
    30_000,
  );

  runIntegration(
    "rolls back safely when no trial evidence exists",
    async () => {
      await apply(
        "backend/db/migrations/20260720001100_source_trial_foundation.down.sql",
      );
      expect(
        await psql(["-A", "-t", "-q", "-c", `
          SELECT to_regclass('public.source_trial_runs') IS NULL
            AND to_regclass('public.jobs') IS NOT NULL;
        `]),
      ).toBe("t");
      await apply(
        "backend/db/migrations/20260720001100_source_trial_foundation.sql",
      );
    },
    30_000,
  );
});
