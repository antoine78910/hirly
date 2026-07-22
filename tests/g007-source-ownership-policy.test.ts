import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repoRoot, "backend", "db", "migrations");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .sort();
}

function stripDollarQuotedRoutineBodies(sql: string): string {
  return sql.replace(
    /(\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b[\s\S]*?\bAS\s+)(\$[a-z_][a-z0-9_]*\$|\$\$)[\s\S]*?\2/gi,
    "$1$2$2",
  );
}

function stripFreshFranceTravailOwnerSeed(sql: string): string {
  return sql.replace(
    /INSERT INTO public\.provider_registry \([\s\S]*?'france_travail'[\s\S]*?ON CONFLICT \(provider\) DO NOTHING;/,
    "",
  );
}

describe("G007 source ownership and policy invariants", () => {
  test("keeps every characterized ingestion and feed stage Python-owned", () => {
    const registry = JSON.parse(read("artifacts/job-ingestion/stage-registry.json")) as {
      schemaVersion: number;
      stages: Array<{
        stage: string;
        authoritativeWriter: string;
      }>;
    };

    expect(registry.schemaVersion).toBe(1);
    expect(registry.stages.length).toBeGreaterThan(0);
    for (const { authoritativeWriter } of registry.stages) {
      expect(authoritativeWriter).toMatch(/^python(?:$| via [a-z0-9 -]+$)/i);
      expect(authoritativeWriter).not.toMatch(/typescript|dual/i);
    }

    for (const requiredStage of [
      "source_request",
      "normalization",
      "validation",
      "deduplication",
      "canonical_upsert",
      "filtering",
      "matching",
      "application_route",
    ]) {
      expect(registry.stages.some(({ stage }) => stage === requiredStage)).toBeTrue();
    }
  });

  test("does not let Python feed characterization transfer provider ownership", () => {
    const productionPython = readdirSync(join(repoRoot, "backend"))
      .filter((name) => name.endsWith(".py"))
      .map((name) => read(`backend/${name}`))
      .join("\n");

    expect(productionPython).not.toMatch(
      /\bset_provider_writer\b|update\s+(?:public\.)?provider_registry\s+set\s+writer_runtime/i,
    );
  });

  test("retains the existing authorization and single-writer activation gate", () => {
    const foundation = read(
      "backend/db/migrations/20260720000100_typescript_worker_foundation.sql",
    );
    const laterMigrations = migrationFiles()
      .filter((name) => name !== "20260720000100_typescript_worker_foundation.sql")
      .map((name) => read(`backend/db/migrations/${name}`))
      .join("\n");
    const applyTimeSql = stripFreshFranceTravailOwnerSeed(
      stripDollarQuotedRoutineBodies(laterMigrations),
    );

    expect(foundation).toMatch(
      /NOT enabled OR \(\s*authorization_status = 'authorized'\s*AND writer_runtime = 'typescript'/,
    );
    expect(foundation).toMatch(
      /IF p_enabled AND \(\s*v_provider\.authorization_status <> 'authorized'\s*OR v_provider\.writer_runtime <> 'typescript'/,
    );
    expect(foundation).toContain("false, 'none', '{\"requestsPerMinute\":1,\"concurrency\":1}'");
    expect(applyTimeSql).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?provider_registry\b/i,
    );
    expect(laterMigrations).toMatch(
      /'france_travail', 'official-api', 'unverified', NULL,\s*false, 'python'/,
    );
    expect(laterMigrations).toContain("0, false");
    expect(laterMigrations).toContain("ON CONFLICT (provider) DO NOTHING");

    expect(laterMigrations).toMatch(
      /CREATE OR REPLACE FUNCTION worker_private\.transition_provider_writer\([\s\S]*?SECURITY DEFINER\s+SET search_path = pg_catalog\s+AS \$\$/i,
    );
    expect(laterMigrations).toMatch(
      /REVOKE ALL ON FUNCTION worker_private\.transition_provider_writer\(text, text, text, bigint\)\s+FROM PUBLIC;/i,
    );

    const transitionGrants =
      laterMigrations.match(
        /GRANT EXECUTE ON FUNCTION worker_private\.transition_provider_writer\([\s\S]*?;/gi,
      ) ?? [];
    expect(transitionGrants).toHaveLength(1);
    expect(transitionGrants[0]).toMatch(
      /\(\s*text, text, text, bigint\s*\)\s+TO hirly_inventory_operator;/i,
    );
    expect(transitionGrants[0]).not.toMatch(/\b(?:PUBLIC|hirly_inventory_worker|service_role)\b/i);
  });
});
