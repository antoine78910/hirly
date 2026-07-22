import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migrationPath = "backend/db/migrations/20260720000800_ats_tenant_source_registration.sql";
const rollbackPath = "backend/db/migrations/20260720000800_ats_tenant_source_registration.down.sql";

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("G011 disabled ATS tenant registration", () => {
  const migration = read(migrationPath);
  const rollback = read(rollbackPath);
  const registrationFunction = migration.match(
    /CREATE OR REPLACE FUNCTION worker_private\.register_career_source_candidate\([\s\S]*?\n\$\$;/,
  )?.[0];

  test("adapts career_sources without creating a duplicate registry", () => {
    expect(registrationFunction).toBeDefined();
    expect(migration).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?provider_registry\b/i,
    );
    expect(migration).not.toMatch(/\bwriter_runtime\s*=/i);
  });

  test("registers new candidates idempotently and disabled", () => {
    expect(registrationFunction).toContain("FROM public.career_sources AS source");
    expect(registrationFunction).toContain("source.source_key = btrim(p_source_key)");
    expect(registrationFunction).toContain("source.tenant_key = btrim(p_tenant_key)");
    expect(registrationFunction).toContain("career source key and tenant identify different rows");
    expect(registrationFunction).toContain(
      "pg_advisory_xact_lock(hashtextextended(p_provider, 0))",
    );
    expect(registrationFunction).toMatch(
      /INSERT INTO public\.career_sources[\s\S]*?false,\s*'candidate',\s*false,\s*false,\s*false/,
    );
    expect(registrationFunction).not.toContain("p_policy_id");
    expect(registrationFunction).toMatch(/p_access_type,\s*NULL,/);
    expect(registrationFunction).not.toMatch(/\btrue\b/i);
  });

  test("does not let rediscovery mutate activation, checkpoint, or health", () => {
    const update = registrationFunction?.match(
      /UPDATE public\.career_sources[\s\S]*?RETURNING \* INTO v_source;/,
    )?.[0];
    expect(update).toBeDefined();
    for (const protectedColumn of [
      "enabled",
      "transport_enabled",
      "incremental_enabled",
      "backfill_enabled",
      "checkpoint",
      "last_attempt_at",
      "last_success_at",
      "last_complete_run_id",
      "consecutive_failures",
      "discovery_state",
    ]) {
      expect(update, `rediscovery must preserve ${protectedColumn}`).not.toMatch(
        new RegExp(`\\b${protectedColumn}\\s*=`),
      );
    }
    expect(registrationFunction).toContain("IF v_source.discovery_state = 'approved'");
  });

  test("requires bounded metadata and keeps direct table writes unavailable", () => {
    expect(registrationFunction).toContain(
      "worker_private.country_code_array_is_valid(p_country_codes)",
    );
    expect(registrationFunction).toContain("p_base_url !~ '^https://");
    expect(registrationFunction).toContain(
      "p_access_type NOT IN ('public_api', 'open_data', 'tenant_feed', 'partner_feed')",
    );
    expect(registrationFunction).toContain("jsonb_typeof(p_checkpoint) <> 'object'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION worker_private\.register_career_source_candidate\([\s\S]*?\) FROM PUBLIC;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION worker_private\.register_career_source_candidate\([\s\S]*?\) TO hirly_inventory_worker, hirly_inventory_operator;/,
    );
    expect(migration).not.toMatch(
      /\bGRANT\s+(?:INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.career_sources\b/i,
    );
  });

  test("is reversible without touching source data", () => {
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS worker_private.register_career_source_candidate(",
    );
    expect(rollback).not.toMatch(/\b(?:DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
  });
});
