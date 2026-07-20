import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createDatabase } from "@hirly/db";
import {
  coverageDigest,
  producePaidCohortCoverage,
  type PaidCohortCoverageInput,
} from "../src/paid-cohort-coverage";
import { PostgresPaidCohortCoverageStore } from "../src/paid-cohort-coverage-store";

const databaseUrl = process.env.G016_COVERAGE_DATABASE_URL;
const repoRoot = join(import.meta.dir, "../../..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(args: string[]): Promise<string> {
  if (!databaseUrl) throw new Error("G016_COVERAGE_DATABASE_URL is required");
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

const input: PaidCohortCoverageInput = {
  coverageRunId: "00000000-0000-4000-8000-000000000031",
  generatedAt: "2026-07-20T14:00:00.000Z",
  freshnessCutoff: "2026-06-20T14:00:00.000Z",
  freshnessWindowDays: 30,
  evaluatorVersion: "g016.pg.v1",
  cohort: [{
    hashedUserId: coverageDigest("integration-paid-user"),
    cohortDimensions: { country_code: "FR", subscription_tier: "paid" },
    roleTokens: ["engineer"],
    countryCodes: ["FR"],
    seenCanonicalGroupDigests: [],
  }],
  trialSources: [{
    trialRunId: "00000000-0000-4000-8000-000000000020",
    sourceId: "00000000-0000-4000-8000-000000000010",
    provider: "greenhouse",
    tenantKey: "acme",
  }],
};

describe("G016 paid cohort coverage PostgreSQL producer", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
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
      "20260720001150_source_trial_tenant_selection_binding.sql",
    ]) {
      await apply(`backend/db/migrations/${migration}`);
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
        public.worker_runs,
        public.jobs
      CASCADE;

      INSERT INTO public.provider_registry (
        provider, access_method, authorization_status, enabled,
        writer_runtime, rate_limit_config
      ) VALUES (
        'greenhouse', 'fixture', 'unverified', false, 'none',
        '{"requestsPerMinute":1,"concurrency":1}'::jsonb
      )
      ON CONFLICT (provider) DO UPDATE
      SET enabled = false, writer_runtime = 'none';

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
        max_bytes_per_run, trial_enabled,
        tenant_selection_evidence_reference,
        tenant_selection_evidence_sha256
      ) VALUES (
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'acme',
        '00000000-0000-4000-8000-000000000011',
        'tenant_feed', 'test', '2026-07-20T12:00:00Z',
        '2026-07-20T15:00:00Z', 10, 1, 10, 100000, false,
        'artifacts/g016-tenant-selection.json', repeat('f', 64)
      );

      INSERT INTO public.source_trial_runs (
        id, trial_key, policy_id, source_id, provider, tenant_key, environment,
        country_codes, policy_evidence_id, requested_at, expires_at,
        max_pages, max_candidates, max_bytes, manifest, created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000020', 'g016:coverage',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000010',
        'greenhouse', 'acme', 'test', ARRAY['FR'],
        '00000000-0000-4000-8000-000000000011',
        '2026-07-20T13:00:00Z', '2026-07-20T15:00:00Z',
        1, 10, 100000,
        '{"tenantSelectionEvidence":{"reference":"artifacts/g016-tenant-selection.json","sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}}'::jsonb,
        '2026-07-20T13:00:00Z'
      );

      INSERT INTO public.source_trial_pages (
        id, run_id, page_number, fetched_at, content_hash, byte_count, payload,
        created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000022',
        '00000000-0000-4000-8000-000000000020',
        1, '2026-07-20T13:05:00Z', repeat('b', 64), 2, '{}'::jsonb,
        '2026-07-20T13:05:00Z'
      );

      INSERT INTO public.source_trial_candidates (
        run_id, page_id, candidate_key, content_hash, candidate, created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000020',
        '00000000-0000-4000-8000-000000000022',
        'candidate-1', repeat('c', 64),
        '{
          "externalId":"trial-1",
          "title":"Platform Engineer",
          "countryCode":"FR",
          "fingerprint":"trial-fingerprint",
          "selectedApplyUrl":"https://boards.greenhouse.io/acme/jobs/1",
          "validationStatus":"valid",
          "applyabilityTier":"A",
          "requiresLogin":false,
          "requiresAccountCreation":false,
          "captchaDetected":false,
          "atsProvider":"greenhouse",
          "lastSeenAt":"2026-07-19T00:00:00Z"
        }'::jsonb,
        '2026-07-20T13:10:00Z'
      );

      INSERT INTO public.source_trial_scorecards (
        run_id, scorecard_key, result, created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000020', 'trial-result',
        '{"status":"completed","finishedAt":"2026-07-20T13:30:00Z"}'::jsonb,
        '2026-07-20T13:30:00Z'
      );

      INSERT INTO public.worker_runs (
        id, kind, provider, idempotency_key, trigger_source, status,
        requested_at, started_at, summary, created_at, updated_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000031',
        'inventory_maintenance', NULL, 'g016:coverage-producer', 'system',
        'running', '2026-07-20T12:00:00Z', '2026-07-20T12:01:00Z',
        '{}'::jsonb, '2026-07-20T12:00:00Z', '2026-07-20T12:01:00Z'
      );

      INSERT INTO public.jobs (
        job_id, provider, external_id, title, normalized_title, country_code,
        imported_at, last_seen_at, selected_apply_url, validation_status,
        applyability_tier, requires_login, requires_account_creation,
        captcha_detected, fingerprint, data
      ) VALUES (
        'current-1', 'france_travail', 'current-1',
        'Software Engineer', 'software engineer', 'FR',
        '2026-07-10T00:00:00Z', '2026-07-10T00:00:00Z',
        'https://example.test/current-1', 'valid', 'A',
        false, false, false, 'current-fingerprint', '{}'::jsonb
      );
    `]);
  });

  runIntegration("persists once, replays idempotently, and never mutates jobs", async () => {
    const database = createDatabase(databaseUrl!, { max: 2 });
    try {
      const store = new PostgresPaidCohortCoverageStore(database);
      const before = await psql(["-A", "-t", "-q", "-c", "SELECT count(*) FROM public.jobs"]);
      const first = await producePaidCohortCoverage(input, store);
      const second = await producePaidCohortCoverage(input, store);
      const after = await psql(["-A", "-t", "-q", "-c", "SELECT count(*) FROM public.jobs"]);
      expect(first.persistence).toBe("persisted");
      expect(second.persistence).toBe("idempotent");
      expect(second.evidenceDigest).toBe(first.evidenceDigest);
      expect(after).toBe(before);
      expect(await psql([
        "-A", "-t", "-q", "-c",
        "SELECT count(*) FROM public.paid_user_inventory_snapshots",
      ])).toBe("1");
      expect(await psql([
        "-A", "-t", "-q", "-c",
        "SELECT count(*) FROM public.paid_user_source_contributions",
      ])).toBe("1");
    } finally {
      await database.end({ timeout: 5 });
    }
  });
});
