import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../backend/db/migrations/20260720000400_job_supply_observability.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../backend/db/migrations/20260720000400_job_supply_observability.down.sql", import.meta.url),
  "utf8",
);
const runner = readFileSync(
  new URL("../apps/job-ingestion-audit/src/live-census.ts", import.meta.url),
  "utf8",
);

describe("G008 job-supply observability contract", () => {
  test("extends the existing run ledger and adds the required baselines", () => {
    expect(migration).toContain("ALTER TABLE public.worker_runs");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.job_supply_source_baseline");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.job_supply_ats_host_baseline");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.paid_user_inventory_baseline");
    expect(migration).toContain("percentile_cont(0.1)");
    expect(migration).toContain("percentile_cont(0.5)");
    expect(migration).toContain("percentile_cont(0.9)");
    expect(migration).toContain("unseen_actionable_total = 0");
  });

  test("keeps source metadata disabled and provider_registry authoritative", () => {
    expect(migration).toContain("collection_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("career_sources_disabled_guard CHECK (collection_enabled = false)");
    expect(migration).toContain("production_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("source_policies_disabled_guard CHECK (production_enabled = false)");
    expect(migration).not.toMatch(/(?:INSERT\s+INTO|UPDATE)\s+public\.provider_registry/i);
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]*public\.jobs/i);
    expect(migration).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.jobs/i);
    expect(runner).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.jobs/i);
  });

  test("links snapshots and immutable census evidence to durable runs", () => {
    expect(migration).toContain(
      "coverage_run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.france_travail_census_manifest_runs");
    expect(migration).toContain(
      "run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT",
    );
    expect(migration).toContain("france_travail_census_manifest_runs_immutable");
    expect(migration).toContain("france_travail_census_manifests_immutable");
  });

  test("requires complete census totals to reconcile", () => {
    expect(migration).toMatch(
      /terminal_state <> 'complete'\s+OR \(\s*source_reported_total IS NOT NULL\s+AND fetched_records = source_reported_total/s,
    );
    expect(migration).toContain("fetched_records = normalized_records + rejected_records");
    expect(migration).toContain("actionable_records <= normalized_records");
    expect(runner).toContain("capHit: row.counters.cap_hit === true");
  });

  test("rolls back every added object and ledger field", () => {
    for (const object of [
      "public.paid_user_inventory_baseline",
      "public.job_supply_ats_host_baseline",
      "public.job_supply_source_baseline",
      "public.france_travail_census_manifest_runs",
      "public.france_travail_census_manifests",
      "public.paid_user_inventory_snapshots",
      "public.source_policies",
      "public.career_sources",
    ]) {
      expect(rollback).toContain(object);
    }
    for (const column of [
      "actionable_records", "cost_microunits", "duration_ms",
      "requests_completed", "cursor", "scope", "run_mode",
    ]) {
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
  });
});
