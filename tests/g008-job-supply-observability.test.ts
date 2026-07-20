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
const queries = readFileSync(
  new URL("../apps/job-ingestion-audit/src/queries.ts", import.meta.url),
  "utf8",
);
const careerSourcesDefinition = migration.match(
  /CREATE TABLE IF NOT EXISTS public\.career_sources \([\s\S]*?\n\);/,
)?.[0] ?? "";
const censusManifestDefinition = migration.match(
  /CREATE TABLE IF NOT EXISTS public\.france_travail_census_manifests \([\s\S]*?\n\);/,
)?.[0] ?? "";

describe("G008 job-supply observability contract", () => {
  test("extends the existing run ledger and adds the required baselines", () => {
    expect(migration).toContain("ALTER TABLE public.worker_runs");
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.source_runs/i);
    for (const field of [
      "career_source_id",
      "run_mode",
      "normalized_scope",
      "checkpoint_in",
      "checkpoint_out",
      "requests_count",
      "response_bytes",
      "request_cost_minor",
      "request_cost_currency",
      "complete_scope_token",
      "accounting_residuals",
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${field}`);
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${field}`);
    }
  });

  test("keeps provider_registry as the sole writer authority and every source disabled", () => {
    expect(migration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO)\s+(?:public\.)?provider_registry\b/i,
    );
    expect(migration).toContain(
      "provider text NOT NULL REFERENCES public.provider_registry(provider)",
    );
    expect(migration.match(/enabled boolean NOT NULL DEFAULT false/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(migration).toContain(
      "CREATE OR REPLACE VIEW public.career_source_activation_status",
    );
    expect(migration).toContain("registry.writer_runtime IN ('python', 'typescript')");
    expect(careerSourcesDefinition).not.toContain("writer_runtime");
    expect(migration).not.toMatch(
      /GRANT INSERT ON public\.(?:career_sources|source_policy)/i,
    );
    for (const policyGate of [
      "NEW.commercial_use_allowed",
      "NEW.redisplay_allowed",
      "NEW.expires_at <= clock_timestamp()",
      "registry.enabled",
      "registry.authorization_status = 'authorized'",
      "policy.expires_at > clock_timestamp()",
    ]) {
      expect(migration).toContain(policyGate);
    }
  });

  test("persists PII-safe paid-user metrics and the required aggregate baseline", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.paid_user_inventory_snapshots");
    expect(migration).toMatch(/(?:hashed_user_id|user_hash) text NOT NULL/);
    expect(migration).toContain("cohort_dimensions_are_safe");
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
    expect(queries).toContain("percentile_cont(0.1)");
    expect(queries).toContain("percentile_cont(0.5)");
    expect(queries).toContain("percentile_cont(0.9)");
    expect(queries).toContain("feed_exhaustion_rate");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.paid_user_source_contributions");
    expect(migration).toContain("affected_paid_users");
    expect(migration).toContain("incremental boolean NOT NULL");
    expect(migration).toContain("unique_total <= relevant_total");
  });

  test("records source, ATS-host, freshness, route and duplicate baselines read-only", () => {
    for (const metric of [
      "sourceInventory",
      "atsHostCensus",
      "routeQuality",
      "providerConcentration",
      "paidUserCoverage",
      "runCompleteness",
      "franceTravailPartitions",
      "estimated_duplicate_rate",
      "canonical_apply_url_rate",
      "actionable",
      "france_jobs",
    ]) {
      expect(queries).toContain(metric);
    }
    expect(queries).toContain("assertReadOnlyObservabilityQueries");
    expect(queries).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?public\.jobs\b/i);
  });

  test("makes reconciled France Travail census manifests immutable", () => {
    expect(censusManifestDefinition).not.toContain("coverage_run_id");
    expect(migration).toContain(
      "source_run_ids uuid[] NOT NULL CHECK (cardinality(source_run_ids) > 0)",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.france_travail_census_manifest_runs",
    );
    expect(migration).toContain(
      "run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT",
    );
    expect(migration).toContain("manifest_digest text NOT NULL UNIQUE");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toMatch(/reject_immutable_census_(?:manifest|evidence)/);
  });

  test("rolls back every added object and ledger field", () => {
    for (const object of [
      "france_travail_census_manifests",
      "paid_user_inventory_snapshots",
      "paid_user_source_contributions",
      "source_policy",
      "career_sources",
    ]) {
      expect(rollback).toContain(object);
    }
    for (const column of [
      "career_source_id",
      "run_mode",
      "normalized_scope",
      "checkpoint_in",
      "checkpoint_out",
      "requests_count",
      "response_bytes",
      "duration_ms",
      "request_cost_minor",
      "request_cost_currency",
      "actionable_records",
      "planned_scope_token",
      "complete_scope_token",
      "accounting_residuals",
    ]) {
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
  });
});
