import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260720000400_job_supply_observability.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../backend/db/migrations/20260720000400_job_supply_observability.down.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("G008 job-supply observability migration", () => {
  test("extends the existing run ledger without creating a competing run system", () => {
    expect(migration).toContain("ALTER TABLE public.worker_runs");
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.source_runs/i);
    for (const field of [
      "run_mode",
      "scope",
      "cursor",
      "requests_completed",
      "duration_ms",
      "cost_microunits",
      "actionable_records",
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${field}`);
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${field}`);
    }
  });

  test("keeps provider_registry as the sole writer authority and every source disabled", () => {
    expect(migration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO)\s+(?:public\.)?provider_registry\b/i,
    );
    expect(migration).not.toMatch(/\bwriter_runtime\b/i);
    expect(migration).toContain(
      "provider text NOT NULL REFERENCES public.provider_registry(provider)",
    );
    expect(migration).toContain("collection_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("career_sources_disabled_guard CHECK (collection_enabled = false)");
    expect(migration).toContain("production_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("source_policies_disabled_guard CHECK (production_enabled = false)");
    expect(migration).not.toMatch(
      /GRANT INSERT ON public\.(?:career_sources|source_policies)/i,
    );
  });

  test("persists PII-safe paid-user metrics and the required aggregate baseline", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.paid_user_inventory_snapshots");
    expect(migration).toContain("hashed_user_id text NOT NULL");
    expect(migration).not.toMatch(/\b(?:cv_text|resume|target_role|target_location)\b/i);
    for (const metric of [
      "relevant_total",
      "unique_total",
      "actionable_total",
      "unseen_actionable_total",
      "route_known_total",
      "direct_employer_total",
      "evaluator_version",
    ]) {
      expect(migration).toContain(metric);
    }
    expect(migration).toContain("percentile_cont(0.1)");
    expect(migration).toContain("percentile_cont(0.5)");
    expect(migration).toContain("percentile_cont(0.9)");
    expect(migration).toContain("AS exhaustion_rate");
  });

  test("records source, ATS-host, freshness, route and duplicate baselines read-only", () => {
    expect(migration).toContain("CREATE OR REPLACE VIEW public.job_supply_source_baseline");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.job_supply_ats_host_baseline");
    for (const metric of [
      "seen_1d",
      "seen_7d",
      "seen_30d",
      "actionable",
      "route_known",
      "estimated_duplicate_rate",
      "apply_host",
      "france_jobs",
      "valid_jobs",
    ]) {
      expect(migration).toContain(metric);
    }
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?public\.jobs\b/i);
  });

  test("makes reconciled France Travail census manifests immutable", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.france_travail_census_manifests",
    );
    expect(migration).toContain("manifest_digest text NOT NULL UNIQUE");
    expect(migration).toContain(
      "terminal_state IN ('complete', 'capped', 'blocked', 'failed')",
    );
    expect(migration).toContain("fetched_records = normalized_records + rejected_records");
    expect(migration).toContain("actionable_records <= normalized_records");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("reject_immutable_census_manifest");
  });

  test("fully reverses additive G008 objects", () => {
    for (const object of [
      "paid_user_inventory_baseline",
      "job_supply_ats_host_baseline",
      "job_supply_source_baseline",
      "france_travail_census_manifests",
      "paid_user_inventory_snapshots",
      "source_policies",
      "career_sources",
    ]) {
      expect(rollback).toContain(object);
    }
  });
});
