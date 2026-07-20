import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const directory = join(repoRoot, "backend", "db", "migrations");
const forwardName = "20260720000700_provider_ownership_epochs.sql";
const rollbackName = "20260720000700_provider_ownership_epochs.down.sql";
const migration = readFileSync(join(directory, forwardName), "utf8");
const rollback = readFileSync(join(directory, rollbackName), "utf8");

describe("G010 whole-provider ownership epoch migration", () => {
  test("has exactly one 00700 forward/rollback pair", () => {
    expect(
      readdirSync(directory).filter((name) => name.startsWith("20260720000700_"))
        .sort(),
    ).toEqual([rollbackName, forwardName]);
  });

  test("uses provider_registry as the sole epoch authority without activation", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS ownership_epoch bigint NOT NULL DEFAULT 0",
    );
    expect(migration).toContain(
      "registry.ownership_epoch = claim.ownership_epoch",
    );
    const migrationWithoutFreshFranceTravailSeed = migration.replace(
      /INSERT INTO public\.provider_registry \([\s\S]*?'france_travail'[\s\S]*?ON CONFLICT \(provider\) DO NOTHING;/,
      "",
    );
    expect(migrationWithoutFreshFranceTravailSeed).not.toMatch(
      /^(?:INSERT\s+INTO|UPDATE)\s+(?:public\.)?provider_registry\b/im,
    );
    expect(migration).toMatch(
      /'france_travail', 'official-api', 'unverified', NULL,\s*false, 'python'/,
    );
    expect(migration).toContain("0, false");
    expect(migration).toContain("ON CONFLICT (provider) DO NOTHING");
    expect(migration).not.toMatch(
      /^(?:INSERT\s+INTO|UPDATE)\s+(?:public\.)?(?:career_sources|worker_schedules)\b/im,
    );
    expect(migration).toContain("enabled = false");
  });

  test("fences pre-fetch claims, transitions, ABA, heartbeat, finish, and writes", () => {
    for (const contract of [
      "worker_private.transition_provider_writer",
      "worker_private.claim_provider_work",
      "worker_private.heartbeat_provider_work",
      "worker_private.finish_provider_work",
      "worker_private.release_provider_work",
      "worker_private.write_jobs_and_complete",
      "public.python_provider_work_claim",
      "public.python_provider_work_heartbeat",
      "public.python_provider_work_finish",
      "public.python_provider_jobs_upsert",
    ]) {
      expect(migration).toContain(contract);
    }
    expect(migration).toContain("provider_work_claims_live_operation_unique");
    expect(migration).toContain("provider_work_claims_task_attempt_unique");
    expect(migration).toContain(
      "INSERT INTO public.provider_work_claims AS inserted_claim",
    );
    expect(migration).toContain("FROM public.worker_tasks AS task");
    expect(migration).toContain("task.provider = p_provider");
    expect(migration).toContain("inserted_claim.provider");
    expect(migration).toContain("provider work claim history is immutable");
    expect(migration).toContain("provider writer must transition through none");
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS claims_required boolean NOT NULL DEFAULT false",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS lifecycle_claims_ready boolean NOT NULL DEFAULT false",
    );
    expect(migration).toContain(
      "provider lifecycle claim boundary is not ready",
    );
    expect(migration).toContain(
      "worker_private.enable_provider_claim_enforcement",
    );
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.jobs");
    expect(migration).toContain(
      "registry.ownership_epoch = claim.ownership_epoch",
    );
  });

  test("keeps security-definer routines private and preserves Python row shape", () => {
    const securityDefiners = migration.match(
      /SECURITY DEFINER[\s\S]*?SET search_path = [^\n]+/g,
    ) ?? [];
    expect(securityDefiners.length).toBeGreaterThan(0);
    for (const definition of securityDefiners) {
      expect(definition).toContain("SET search_path = pg_catalog");
      expect(definition).not.toContain("pg_catalog,");
    }
    expect(migration).toContain("REVOKE ALL ON public.provider_work_claims");
    expect(migration).toContain("FROM PUBLIC");
    for (const column of [
      "city",
      "region",
      "remote",
      "salary_min",
      "salary_max",
      "currency",
      "posted_at",
      "provider_search_key",
      "canonical_apply_url",
      "ats_job_id",
      "has_cv_upload",
      "has_cover_letter",
      "has_custom_questions",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("deterministic job id collision");
  });

  test("rolls back every additive object and restores legacy grants", () => {
    expect(rollback).toContain("DROP TABLE IF EXISTS public.provider_work_claims");
    expect(rollback).toContain("DROP COLUMN IF EXISTS ownership_epoch");
    expect(rollback).toContain("DROP COLUMN IF EXISTS lifecycle_claims_ready");
    expect(rollback).toContain(
      "GRANT EXECUTE ON FUNCTION worker_private.set_provider_writer",
    );
    expect(rollback).toContain(
      "GRANT EXECUTE ON FUNCTION worker_private.write_jobs_and_complete",
    );
  });
});
