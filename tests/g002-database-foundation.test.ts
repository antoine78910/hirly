import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repoRoot, "backend", "db", "migrations");

function foundationMigration(): { path: string; sql: string } {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({
      path: join(migrationsDirectory, name),
      sql: readFileSync(join(migrationsDirectory, name), "utf8"),
    }))
    .filter(({ sql }) =>
      [
        "worker_runs",
        "worker_tasks",
        "worker_task_attempts",
        "worker_schedules",
        "provider_registry",
      ].every((table) => sql.includes(table)),
    );

  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function compact(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
}

describe("G002 additive inventory migration", () => {
  test("creates the durable worker tables without changing canonical jobs", () => {
    const migration = foundationMigration();
    const sql = compact(migration.sql);

    expect(basename(migration.path)).toMatch(
      /^\d+_typescript_worker_foundation\.sql$/,
    );
    for (const table of [
      "worker_runs",
      "worker_tasks",
      "worker_task_attempts",
      "worker_schedules",
      "provider_registry",
    ]) {
      expect(sql).toMatch(
        new RegExp(`create table(?: if not exists)? (?:public\\.)?${table}\\b`),
      );
    }

    expect(sql).not.toMatch(/\balter table (?:public\.)?jobs\b/);
    expect(sql).not.toMatch(/\bdrop (?:table|index|constraint).*?\bjobs\b/);
  });

  test("enforces idempotency, lease fencing, and immutable attempts", () => {
    const sql = compact(foundationMigration().sql);

    expect(sql).toMatch(/unique\s*\(\s*kind\s*,\s*idempotency_key\s*\)/);
    expect(sql).toMatch(/unique\s*\(\s*run_id\s*,\s*task_key\s*\)/);
    expect(sql).toMatch(
      /unique\s*\(\s*task_id\s*,\s*attempt_number\s*\)/,
    );
    expect(sql).toContain("lease_token");
    expect(sql).toContain("claim_generation");
    expect(sql).toContain("for update skip locked");
    expect(sql).toMatch(/attempts\s*<\s*max_attempts/);
    expect(sql).toMatch(/worker_task_attempts[\s\S]*on delete restrict/);
    expect(sql).toMatch(
      /(?:revoke|trigger)[\s\S]*worker_task_attempts|worker_task_attempts[\s\S]*(?:revoke|trigger)/,
    );
  });

  test("serializes provider authorization, writer ownership, and scheduling", () => {
    const sql = compact(foundationMigration().sql);

    expect(sql).toMatch(
      /enabled[\s\S]*authorization_status[\s\S]*authorized[\s\S]*writer_runtime[\s\S]*typescript/,
    );
    expect(sql).toMatch(/provider_registry[\s\S]*for (?:no key )?update/);
    expect(sql).toMatch(/worker_schedules[\s\S]*for (?:no key )?update/);
    expect(sql).toMatch(
      /unique[\s\S]*schedule_id[\s\S]*scheduled_for|schedule_id[\s\S]*scheduled_for[\s\S]*unique/,
    );
    expect(sql).toMatch(/writer_runtime[\s\S]*(?:python|typescript)/);
  });

  test("locks down every security-definer function", () => {
    const sql = foundationMigration().sql;
    const normalized = compact(sql);
    const securityDefinerFunctions = Array.from(
      normalized.matchAll(
        /create(?: or replace)? function\s+([a-z0-9_."]+)[\s\S]*?security definer/g,
      ),
      (match) => match[1]!,
    );

    expect(securityDefinerFunctions.length).toBeGreaterThan(0);
    expect(normalized).toMatch(
      /security definer[\s\S]*set search_path\s*=\s*(?:pg_catalog|public)/,
    );

    for (const functionName of securityDefinerFunctions) {
      const shortName = functionName.replace(/^public\./, "").replaceAll('"', "");
      expect(normalized).toMatch(
        new RegExp(
          `revoke execute on function [^;]*${shortName}[^;]* from (?:public|anon|authenticated)`,
        ),
      );
    }

    expect(normalized).toMatch(/grant execute on function[\s\S]*worker/);
    expect(normalized).toMatch(/grant execute on function[\s\S]*operator/);
    expect(normalized).toMatch(
      /revoke[\s\S]*(?:anon|authenticated|public)[\s\S]*(?:worker_tasks|provider_registry)/,
    );
  });
});
