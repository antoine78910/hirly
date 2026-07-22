import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migration = readFileSync(
  join(repoRoot, "backend/db/migrations/20260720000900_ats_registration_activation_hardening.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(
    repoRoot,
    "backend/db/migrations/20260720000900_ats_registration_activation_hardening.down.sql",
  ),
  "utf8",
);

describe("G011 ATS registration privilege hardening", () => {
  test("removes policy attachment from the discovery RPC", () => {
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS worker_private.register_career_source_candidate(",
    );
    const registration = migration.match(
      /CREATE OR REPLACE FUNCTION worker_private\.register_career_source_candidate\([\s\S]*?\n\$\$;/,
    )?.[0];
    expect(registration).toBeDefined();
    expect(registration).not.toContain("p_policy_id");
    expect(registration).toMatch(
      /INSERT INTO public\.career_sources[\s\S]*?p_access_type,\s*NULL,/,
    );
    expect(registration).not.toMatch(/\bpolicy_id\s*=/);
  });

  test("requires operator-owned approval with an unchanged safe base URL", () => {
    const approval = migration.match(
      /CREATE OR REPLACE FUNCTION worker_private\.approve_career_source_candidate\([\s\S]*?\n\$\$;/,
    )?.[0];
    expect(approval).toBeDefined();
    expect(approval).toContain("v_source.base_url IS DISTINCT FROM p_expected_base_url");
    expect(approval).toContain("worker_private.career_source_base_url_is_safe(v_source.base_url)");
    expect(approval).toContain("policy.provider = v_source.provider");
    expect(approval).toContain("discovery_state = 'approved'");
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION worker_private\.approve_career_source_candidate\([\s\S]*?\) TO hirly_inventory_operator;/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION worker_private\.approve_career_source_candidate\([\s\S]*?\) TO [^;]*hirly_inventory_worker/,
    );
  });

  test("rejects noncanonical local, IP, credential, and custom-port URLs", () => {
    const validator = migration.match(
      /CREATE OR REPLACE FUNCTION worker_private\.career_source_base_url_is_safe\([\s\S]*?\n\$\$;/,
    )?.[0];
    expect(validator).toBeDefined();
    expect(validator).toContain("v_hostname !~ '^[0-9.]");
    expect(validator).toContain("v_hostname <> 'localhost'");
    expect(validator).toContain("v_hostname !~ '\\.(?:localhost|local|internal|home\\.arpa)$'");
    expect(validator).toContain("v_authority ~ ':' AND v_authority !~ ':443$'");
  });

  test("requires approved discovery and a safe stored URL at both gates", () => {
    const activation = migration.match(
      /CREATE OR REPLACE FUNCTION worker_private\.enforce_career_source_activation\(\)[\s\S]*?\n\$\$;/,
    )?.[0];
    const runnable = migration.match(
      /CREATE OR REPLACE FUNCTION worker_private\.career_source_runnable\([\s\S]*?\n\$\$;/,
    )?.[0];
    expect(activation).toContain("NEW.discovery_state <> 'approved'");
    expect(activation).toContain("career_source_base_url_is_safe(NEW.base_url)");
    expect(runnable).toContain("source.discovery_state = 'approved'");
    expect(runnable).toContain("career_source_base_url_is_safe(source.base_url)");
  });

  test("rolls activation functions back and can be reapplied", () => {
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS worker_private.approve_career_source_candidate(",
    );
    expect(rollback).toContain(
      "CREATE OR REPLACE FUNCTION worker_private.enforce_career_source_activation()",
    );
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION worker_private.career_source_runnable(");
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS worker_private.career_source_base_url_is_safe(text)",
    );
  });
});
