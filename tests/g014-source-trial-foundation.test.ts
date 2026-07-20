import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migration = readFileSync(
  join(
    repoRoot,
    "backend/db/migrations/20260720001100_source_trial_foundation.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  join(
    repoRoot,
    "backend/db/migrations/20260720001100_source_trial_foundation.down.sql",
  ),
  "utf8",
);

describe("G014 source trial foundation", () => {
  test("creates disabled, tenant-bound, expiring trial policy and budgets", () => {
    expect(migration).toMatch(/trial_enabled boolean NOT NULL DEFAULT false/i);
    expect(migration).toMatch(
      /FOREIGN KEY \(source_id, provider\)[\s\S]*REFERENCES public\.career_sources\(id, provider\)/i,
    );
    expect(migration).toMatch(
      /environment IN \('development', 'test', 'staging'\)/i,
    );
    expect(migration).not.toMatch(
      /environment IN \([^)]*'production'/i,
    );
    for (const gate of [
      "max_total_runs",
      "max_pages_per_run",
      "max_candidates_per_run",
      "max_bytes_per_run",
      "policy_evidence_id",
      "expires_at",
      "tenant_key",
    ]) {
      expect(migration).toContain(gate);
    }
    expect(migration).toMatch(
      /source\.access_type = NEW\.permitted_access_method/i,
    );
    expect(migration).toMatch(
      /source_policy_evidence_allows_trial\([\s\S]*'trialEligible', true[\s\S]*'commercial_use'[\s\S]*'redisplay'[\s\S]*'retention'[\s\S]*'access_method'/i,
    );
    expect(migration).not.toMatch(
      /evidence\.qualification_status <> 'blocked'/i,
    );
    expect(migration).toMatch(
      /evidence\.evidence_type IN \('licence_text', 'written_permission'\)/i,
    );
    expect(migration).toMatch(
      /policy\.policy_evidence_id = run\.policy_evidence_id/i,
    );
    expect(migration).not.toContain("evidence.production_eligible");
  });

  test("reconciles the caller's exact serialized page bytes and digest", () => {
    expect(migration).toMatch(
      /p_serialized_payload text,[\s\S]*p_content_hash text,[\s\S]*p_byte_count bigint/i,
    );
    expect(migration).toMatch(
      /v_payload := p_serialized_payload::jsonb/i,
    );
    expect(migration).toMatch(
      /p_content_hash IS NULL OR p_content_hash <> v_content_hash/i,
    );
    expect(migration).toMatch(
      /p_byte_count IS NULL OR p_byte_count <> v_bytes/i,
    );
    expect(migration).toMatch(
      /p_serialized_candidate text,[\s\S]*p_content_hash text/i,
    );
    expect(migration).toMatch(
      /v_candidate := p_serialized_candidate::jsonb/i,
    );
  });

  test("keeps run, page, candidate, and scorecard evidence noncanonical and immutable", () => {
    for (const table of [
      "source_trial_runs",
      "source_trial_pages",
      "source_trial_candidates",
      "source_trial_scorecards",
    ]) {
      expect(migration).toContain(`public.${table}`);
      expect(migration).toMatch(
        new RegExp(`${table}_immutable[\\s\\S]*BEFORE UPDATE OR DELETE`, "i"),
      );
    }
    expect(migration).not.toMatch(
      /INSERT INTO public\.(jobs|job_occurrences|canonical_job_groups|provider_registry|worker_schedules|worker_tasks|applications)\b/i,
    );
    expect(migration).not.toMatch(
      /UPDATE public\.(jobs|job_occurrences|canonical_job_groups|provider_registry|worker_schedules|worker_tasks|applications)\b/i,
    );
  });

  test("allows exactly one reconciled terminal result per run", () => {
    expect(migration).toMatch(
      /source_trial_scorecards_run_unique UNIQUE \(run_id\)/i,
    );
    expect(migration).toMatch(
      /source_trial_scorecards_terminal_key[\s\S]*scorecard_key = 'trial-result'/i,
    );
    expect(migration).toMatch(
      /record_source_trial_scorecard[\s\S]*pg_advisory_xact_lock\(hashtextextended\(p_run_id::text, 0\)\)/i,
    );
    expect(migration).toMatch(
      /p_result \?& ARRAY\[[\s\S]*'stopReason'[\s\S]*\]/i,
    );
    expect(migration).toMatch(
      /v_pages_fetched <> v_persisted_pages/i,
    );
    expect(migration).toMatch(
      /v_candidates_observed <> v_persisted_candidates/i,
    );
    expect(migration).toMatch(
      /v_bytes_stored <> v_persisted_bytes/i,
    );
    expect(migration).toMatch(
      /v_status = 'completed' AND v_persisted_pages = 0/i,
    );
    expect(migration).toContain(
      "p_result->>'pagesFetched' !~ '^(0|[1-9][0-9]*)$'",
    );
    expect(migration).toMatch(
      /NOT EXISTS \([\s\S]*public\.source_trial_scorecards AS terminal[\s\S]*terminal\.run_id = run\.id/i,
    );
  });

  test("grants the NOINHERIT trial role only evidence RPC execution", () => {
    expect(migration).toMatch(
      /CREATE ROLE hirly_source_trial_worker[\s\S]*NOINHERIT/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hirly_source_trial_worker/i,
    );
    const grantedFunctions = [
      ...migration.matchAll(
        /GRANT EXECUTE ON FUNCTION worker_private\.([a-z_]+)/gi,
      ),
    ].map((match) => match[1]);
    expect(grantedFunctions).toEqual([
      "begin_source_trial",
      "record_source_trial_page",
      "record_source_trial_candidate",
      "record_source_trial_scorecard",
    ]);
    expect(migration.match(/SECURITY DEFINER/g)?.length).toBe(5);
    expect(migration).toMatch(
      /SECURITY DEFINER\s+SET search_path = pg_catalog, public, worker_private/gi,
    );
  });

  test("down migration refuses to discard evidence and leaves cluster role intact", () => {
    expect(rollback).toMatch(
      /source trial evidence exists; refusing destructive rollback/i,
    );
    expect(rollback).not.toMatch(/DROP ROLE/i);
    expect(rollback).toMatch(
      /DROP TABLE IF EXISTS public\.source_trial_runs/i,
    );
    expect(rollback).not.toMatch(
      /DROP TABLE IF EXISTS public\.(jobs|job_occurrences|canonical_job_groups|provider_registry|worker_schedules)/i,
    );
  });
});
