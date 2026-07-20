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

describe("G007 source ownership and policy invariants", () => {
  test("keeps every characterized ingestion and feed stage Python-owned", () => {
    const registry = JSON.parse(
      read("artifacts/job-ingestion/stage-registry.json"),
    ) as {
      schemaVersion: number;
      stages: Array<{
        stage: string;
        authoritativeWriter: string;
      }>;
    };

    expect(registry.schemaVersion).toBe(1);
    expect(registry.stages.length).toBeGreaterThan(0);
    expect(
      registry.stages.map(({ stage, authoritativeWriter }) => ({
        stage,
        authoritativeWriter,
      })),
    ).toEqual(
      registry.stages.map(({ stage }) => ({
        stage,
        authoritativeWriter: "python",
      })),
    );

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
      .filter(
        (name) =>
          name !== "20260720000100_typescript_worker_foundation.sql",
      )
      .map((name) => read(`backend/db/migrations/${name}`))
      .join("\n");

    expect(foundation).toMatch(
      /NOT enabled OR \(\s*authorization_status = 'authorized'\s*AND writer_runtime = 'typescript'/,
    );
    expect(foundation).toMatch(
      /IF p_enabled AND \(\s*v_provider\.authorization_status <> 'authorized'\s*OR v_provider\.writer_runtime <> 'typescript'/,
    );
    expect(foundation).toContain(
      "false, 'none', '{\"requestsPerMinute\":1,\"concurrency\":1}'",
    );
    expect(laterMigrations).not.toMatch(
      /update\s+(?:public\.)?provider_registry\s+set\s+(?:enabled|writer_runtime)/i,
    );
  });
});
