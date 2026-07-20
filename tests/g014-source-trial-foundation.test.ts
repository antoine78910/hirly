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
      /evidence\.qualification_status <> 'blocked'/i,
    );
    expect(migration).not.toContain("evidence.production_eligible");
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
