import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260720000400_job_supply_source_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../backend/db/migrations/20260720000400_job_supply_source_foundation.down.sql",
    import.meta.url,
  ),
  "utf8",
);
const operations = readFileSync(
  new URL("../docs/operations/job-supply-source-foundation.md", import.meta.url),
  "utf8",
);

describe("G008 job-supply source metadata foundation", () => {
  test("adds policy and source metadata without adding writer authority", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.source_policy");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.career_sources");
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.source_runs/i);

    const careerSourcesDefinition = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.career_sources"),
      migration.indexOf("ALTER TABLE public.worker_runs"),
    );
    expect(careerSourcesDefinition).not.toContain("writer_runtime");
    expect(careerSourcesDefinition).not.toContain("ownership_epoch");
    expect(migration).toContain("worker_runs_career_source_provider_fk");
    expect(migration).toContain("career_sources_policy_provider_fk");
    expect(migration).not.toMatch(
      /UPDATE\s+(?:public\.)?provider_registry\s+SET\s+(?:enabled|writer_runtime)/i,
    );
  });

  test("keeps every career source disabled during the foundation phase", () => {
    expect(migration).toMatch(/enabled boolean NOT NULL DEFAULT false/);
    expect(migration).toContain(
      "CONSTRAINT career_sources_foundation_disabled_guard CHECK (NOT enabled)",
    );
    expect(migration).toContain("source.enabled");
    expect(migration).toContain("registry.writer_runtime IN ('python', 'typescript')");
  });

  test("extends worker_runs with immutable complete-scope evidence", () => {
    for (const field of [
      "career_source_id",
      "source_mode",
      "normalized_scope",
      "checkpoint_in",
      "checkpoint_out",
      "request_count",
      "response_bytes",
      "cost_minor",
      "planned_scope_token",
      "complete_scope_token",
      "named_residuals",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("complete_scope_token = planned_scope_token");
    expect(migration).toContain("worker_runs_scope_token_immutable");
    expect(migration).toContain("completed source scope proof is immutable");
  });

  test("documents topology, ownership, disabled defaults, and safe rollback", () => {
    for (const requirement of [
      "provider_registry.writer_runtime",
      "enabled_source_count",
      "reconciliation_eligible",
      "Preflight",
      "Post-migration verification",
      "Blocked-to-live transition",
      "Rollback",
    ]) {
      expect(operations).toContain(requirement);
    }
  });

  test("provides an isolated destructive rollback for every additive object", () => {
    expect(rollback).toContain("DROP VIEW IF EXISTS public.source_run_observability");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.career_sources");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.source_policy");
    expect(rollback).toContain("DROP COLUMN IF EXISTS complete_scope_token");
    expect(rollback).toContain("DROP COLUMN IF EXISTS career_source_id");
  });
});
