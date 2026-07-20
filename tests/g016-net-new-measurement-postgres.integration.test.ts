import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const databaseUrl = process.env.G016_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(args: string[]): Promise<string> {
  if (!databaseUrl) throw new Error("G016_TEST_DATABASE_URL is required");
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

async function measure(
  coverageRunId: string,
  trialRunIds = "00000000-0000-4000-8000-000000000020",
): Promise<Record<string, unknown>> {
  const output = await psql([
    "-A",
    "-t",
    "-q",
    "-v",
    "generated_at=2026-07-20T14:00:00Z",
    "-v",
    "freshness_cutoff=2026-06-20T14:00:00Z",
    "-v",
    `coverage_run_id=${coverageRunId}`,
    "-v",
    `trial_run_ids=${trialRunIds}`,
    "-f",
    join(repoRoot, "docs/operations/sql/multi-source-net-new-measurement.sql"),
  ]);
  return JSON.parse(output) as Record<string, unknown>;
}

describe("G016 PostgreSQL measurement provenance", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    const schemaPresent = await psql([
      "-A", "-t", "-q", "-c",
      "SELECT to_regclass('public.source_trial_runs') IS NOT NULL",
    ]);
    if (schemaPresent !== "t") {
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
    }

    await psql(["-q", "-c", `
      TRUNCATE TABLE
        public.source_trial_scorecards,
        public.source_trial_candidates,
        public.source_trial_pages,
        public.source_trial_runs,
        public.source_trial_policies,
        public.paid_user_source_contributions,
        public.paid_user_inventory_snapshots,
        public.career_sources,
        public.source_policy_evidence,
        public.worker_runs
      CASCADE;

      INSERT INTO public.provider_registry (
        provider, access_method, authorization_status, enabled,
        writer_runtime, rate_limit_config
      ) VALUES (
        'greenhouse', 'fixture', 'unverified', false, 'none',
        '{"requestsPerMinute":1,"concurrency":1}'::jsonb
      )
      ON CONFLICT (provider) DO UPDATE SET enabled = false, writer_runtime = 'none';

      INSERT INTO public.career_sources (
        id, provider, source_key, tenant_key, company_name, country_codes,
        base_url, access_type, discovery_state
      ) VALUES (
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'greenhouse:g016-fixture', 'acme', 'G016 Fixture',
        ARRAY['FR'], 'https://example.test/jobs', 'tenant_feed', 'validated'
      );

      INSERT INTO public.source_policy_evidence (
        id, source_key, evidence_key, evidence_type, evidence_reference,
        artifact_path, artifact_sha256, captured_at, qualification_status,
        production_eligible, claim_scope
      ) VALUES (
        '00000000-0000-4000-8000-000000000011',
        'greenhouse:g016-fixture', 'g016-fixture', 'written_permission',
        'g016-test', 'tests/g016-fixture.json', repeat('a', 64),
        '2026-07-20T11:00:00Z', 'requires_legal_review', false, '{}'::jsonb
      );

      INSERT INTO public.source_trial_policies (
        id, source_id, provider, tenant_key, policy_evidence_id,
        permitted_access_method, environment, starts_at, expires_at,
        max_total_runs, max_pages_per_run, max_candidates_per_run,
        max_bytes_per_run, trial_enabled
      ) VALUES (
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'acme',
        '00000000-0000-4000-8000-000000000011',
        'tenant_feed', 'test', '2026-07-20T12:00:00Z',
        '2026-07-20T15:00:00Z', 10, 1, 10, 100000, false
      );

      INSERT INTO public.source_trial_runs (
        id, trial_key, policy_id, source_id, provider, tenant_key, environment,
        country_codes, policy_evidence_id, requested_at, expires_at,
        max_pages, max_candidates, max_bytes, manifest, created_at
      ) VALUES
      (
        '00000000-0000-4000-8000-000000000020', 'g016:complete',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'acme', 'test', ARRAY['FR'],
        '00000000-0000-4000-8000-000000000011',
        '2026-07-20T13:00:00Z', '2026-07-20T15:00:00Z',
        1, 10, 100000, '{}'::jsonb, '2026-07-20T13:00:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000021', 'g016:nonterminal',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'acme', 'test', ARRAY['FR'],
        '00000000-0000-4000-8000-000000000011',
        '2026-07-20T13:00:00Z', '2026-07-20T15:00:00Z',
        1, 10, 100000, '{}'::jsonb, '2026-07-20T13:00:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000024', 'g016:future-candidate',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'acme', 'test', ARRAY['FR'],
        '00000000-0000-4000-8000-000000000011',
        '2026-07-20T13:00:00Z', '2026-07-20T15:00:00Z',
        1, 10, 100000, '{}'::jsonb, '2026-07-20T13:00:00Z'
      );

      INSERT INTO public.source_trial_pages (
        id, run_id, page_number, fetched_at, content_hash, byte_count, payload,
        created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000022',
        '00000000-0000-4000-8000-000000000020',
        1, '2026-07-20T13:05:00Z', repeat('b', 64), 2, '{}'::jsonb,
        '2026-07-20T13:05:00Z'
      ), (
        '00000000-0000-4000-8000-000000000025',
        '00000000-0000-4000-8000-000000000024',
        1, '2026-07-20T14:05:00Z', repeat('d', 64), 2, '{}'::jsonb,
        '2026-07-20T14:05:00Z'
      );

      INSERT INTO public.source_trial_candidates (
        run_id, page_id, candidate_key, content_hash, candidate, created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000020',
        '00000000-0000-4000-8000-000000000022',
        'candidate-1', repeat('c', 64),
        '{"externalId":"job-1","fingerprint":"fixture-fingerprint"}'::jsonb,
        '2026-07-20T13:10:00Z'
      ), (
        '00000000-0000-4000-8000-000000000024',
        '00000000-0000-4000-8000-000000000025',
        'candidate-future', repeat('e', 64),
        '{"externalId":"job-future","fingerprint":"future-fingerprint"}'::jsonb,
        '2026-07-20T14:06:00Z'
      );

      INSERT INTO public.source_trial_scorecards (
        run_id, scorecard_key, result, created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000020', 'trial-result',
        '{"status":"completed","finishedAt":"2026-07-20T13:30:00Z"}'::jsonb,
        '2026-07-20T13:30:00Z'
      ), (
        '00000000-0000-4000-8000-000000000024', 'trial-result',
        '{"status":"completed","finishedAt":"2026-07-20T13:30:00Z"}'::jsonb,
        '2026-07-20T13:30:00Z'
      );

      INSERT INTO public.worker_runs (
        id, kind, provider, idempotency_key, trigger_source, status,
        requested_at, started_at, finished_at, summary, created_at, updated_at
      ) VALUES
      (
        '00000000-0000-4000-8000-000000000030',
        'provider_ingestion', 'greenhouse', 'g016:wrong-kind', 'system',
        'succeeded', '2026-07-20T12:00:00Z', '2026-07-20T12:01:00Z',
        '2026-07-20T12:10:00Z',
        '{"schemaVersion":"hirly.paid-user-inventory-coverage.v1","scope":"paid_user_inventory","coverageRunId":"00000000-0000-4000-8000-000000000030","freshnessWindowDays":30,"freshnessCutoff":"2026-06-20T14:00:00.000Z"}'::jsonb,
        '2026-07-20T12:00:00Z', '2026-07-20T12:10:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000031',
        'inventory_maintenance', NULL, 'g016:valid', 'system',
        'succeeded', '2026-07-20T12:00:00Z', '2026-07-20T12:01:00Z',
        '2026-07-20T12:10:00Z',
        '{"schemaVersion":"hirly.paid-user-inventory-coverage.v1","scope":"paid_user_inventory","coverageRunId":"00000000-0000-4000-8000-000000000031","freshnessWindowDays":30,"freshnessCutoff":"2026-06-20T14:00:00.000Z"}'::jsonb,
        '2026-07-20T12:00:00Z', '2026-07-20T12:10:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000032',
        'inventory_maintenance', NULL, 'g016:wrong-summary', 'system',
        'succeeded', '2026-07-20T12:00:00Z', '2026-07-20T12:01:00Z',
        '2026-07-20T12:10:00Z', '{}'::jsonb,
        '2026-07-20T12:00:00Z', '2026-07-20T12:10:00Z'
      ),
      (
        '00000000-0000-4000-8000-000000000033',
        'inventory_maintenance', NULL, 'g016:late-contribution', 'system',
        'succeeded', '2026-07-20T12:00:00Z', '2026-07-20T12:01:00Z',
        '2026-07-20T12:10:00Z',
        '{"schemaVersion":"hirly.paid-user-inventory-coverage.v1","scope":"paid_user_inventory","coverageRunId":"00000000-0000-4000-8000-000000000033","freshnessWindowDays":30,"freshnessCutoff":"2026-06-20T14:00:00.000Z"}'::jsonb,
        '2026-07-20T12:00:00Z', '2026-07-20T12:10:00Z'
      );

      INSERT INTO public.paid_user_inventory_snapshots (
        coverage_run_id, hashed_user_id, evaluated_at, freshness_window_days,
        relevant_total, unique_total, actionable_total, unseen_actionable_total,
        route_known_total, direct_employer_total, terminal_reason,
        evaluator_version, created_at
      )
      SELECT
        run_id, md5(run_id::text) || md5(run_id::text),
        '2026-07-20T12:05:00Z', 30, 1, 1, 1, 1, 1, 1,
        'complete', 'g016-fixture.v1', '2026-07-20T12:05:00Z'
      FROM unnest(ARRAY[
        '00000000-0000-4000-8000-000000000030'::uuid,
        '00000000-0000-4000-8000-000000000031'::uuid,
        '00000000-0000-4000-8000-000000000032'::uuid,
        '00000000-0000-4000-8000-000000000033'::uuid
      ]) AS run_id;

      INSERT INTO public.paid_user_source_contributions (
        coverage_run_id, source_id, canonical_group_id, affected_paid_users,
        incremental, fresh, relevant, actionable, created_at
      )
      SELECT
        run_id, '00000000-0000-4000-8000-000000000010',
        'fixture-group', 1, true, true, true, true,
        CASE
          WHEN run_id = '00000000-0000-4000-8000-000000000033'::uuid
          THEN '2026-07-20T12:11:00Z'::timestamptz
          ELSE '2026-07-20T12:05:00Z'::timestamptz
        END
      FROM unnest(ARRAY[
        '00000000-0000-4000-8000-000000000030'::uuid,
        '00000000-0000-4000-8000-000000000031'::uuid,
        '00000000-0000-4000-8000-000000000032'::uuid,
        '00000000-0000-4000-8000-000000000033'::uuid
      ]) AS run_id;
    `]);
  });

  runIntegration("accepts only bound paid-inventory coverage evidence", async () => {
    expect((await measure("00000000-0000-4000-8000-000000000031")).status)
      .toBe("COMPLETE");
    for (const coverageRunId of [
      "00000000-0000-4000-8000-000000000030",
      "00000000-0000-4000-8000-000000000032",
      "00000000-0000-4000-8000-000000000033",
      "00000000-0000-4000-8000-000000000099",
    ]) {
      expect((await measure(coverageRunId)).status).toBe("BLOCKED_EXTERNAL");
    }
  });

  runIntegration("blocks missing, nonterminal and duplicate trial evidence", async () => {
    const coverageRunId = "00000000-0000-4000-8000-000000000031";
    expect((await measure(
      coverageRunId,
      "00000000-0000-4000-8000-000000000099",
    )).status).toBe("BLOCKED_EXTERNAL");
    expect((await measure(
      coverageRunId,
      "00000000-0000-4000-8000-000000000021",
    )).status).toBe("BLOCKED_EXTERNAL");
    expect((await measure(
      coverageRunId,
      "00000000-0000-4000-8000-000000000024",
    )).status).toBe("BLOCKED_EXTERNAL");
    expect((await measure(
      coverageRunId,
      "00000000-0000-4000-8000-000000000020,00000000-0000-4000-8000-000000000020",
    )).status).toBe("BLOCKED_EXTERNAL");
  });
});
