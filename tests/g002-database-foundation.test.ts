import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repoRoot, "backend", "db", "migrations");

function foundationMigration(): { path: string; sql: string } {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
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

function securityDefinerFunctions(sql: string): Array<{ name: string; body: string }> {
  return Array.from(
    compact(sql).matchAll(
      /create(?: or replace)? function\s+([a-z0-9_."]+)\s*\([\s\S]*?\)\s*returns[\s\S]*?security definer[\s\S]*?as \$\$([\s\S]*?)\$\$;/g,
    ),
    (match) => ({ name: match[1]!, body: match[2]! }),
  );
}

describe("G002 additive inventory migration", () => {
  test("creates the durable worker tables without changing canonical jobs", () => {
    const migration = foundationMigration();
    const sql = compact(migration.sql);

    expect(basename(migration.path)).toMatch(/^\d+_typescript_worker_foundation\.sql$/);
    for (const table of [
      "worker_runs",
      "worker_tasks",
      "worker_task_attempts",
      "worker_schedules",
      "provider_registry",
    ]) {
      expect(sql).toMatch(new RegExp(`create table(?: if not exists)? (?:public\\.)?${table}\\b`));
    }

    expect(sql).not.toMatch(/\balter table (?:public\.)?jobs\b/);
    expect(sql).not.toMatch(/\bdrop (?:table|index|constraint).*?\bjobs\b/);
  });

  test("enforces idempotency, lease fencing, and immutable attempts", () => {
    const migration = foundationMigration();
    const sql = compact(migration.sql);
    const claimFunction = securityDefinerFunctions(migration.sql).find(
      ({ body }) =>
        body.includes("for update") &&
        body.includes("skip locked") &&
        body.includes("claim_generation"),
    );

    expect(sql).toMatch(/unique\s*\(\s*kind\s*,\s*idempotency_key\s*\)/);
    expect(sql).toMatch(/unique\s*\(\s*run_id\s*,\s*task_key\s*\)/);
    expect(sql).toMatch(/unique\s*\(\s*task_id\s*,\s*attempt_number\s*\)/);
    expect(sql).toContain("lease_token");
    expect(sql).toContain("claim_generation");
    expect(sql).toMatch(/for update(?: of [a-z_]+)? skip locked/);
    expect(sql).toMatch(/(?:[a-z_]+\.)?attempts\s*<\s*(?:[a-z_]+\.)?max_attempts/);
    expect(sql).toMatch(/worker_task_attempts[\s\S]*on delete restrict/);
    expect(sql).toMatch(
      /(?:revoke|trigger)[\s\S]*worker_task_attempts|worker_task_attempts[\s\S]*(?:revoke|trigger)/,
    );
    expect(claimFunction).toBeDefined();
    expect(claimFunction?.body).toContain("lease_expired");
    expect(claimFunction?.body).toMatch(
      /update public\.worker_task_attempts[\s\S]*finished_at[\s\S]*lease_expired/,
    );
  });

  test("serializes provider authorization, writer ownership, and scheduling", () => {
    const migration = foundationMigration();
    const sql = compact(migration.sql);
    const functions = securityDefinerFunctions(migration.sql);
    const scheduleFunction = functions.find(
      ({ body }) =>
        body.includes("worker_schedules") &&
        body.includes("scheduled_for") &&
        body.includes("next_due_at"),
    );
    const canonicalWriteFunction = functions.find(
      ({ body }) => body.includes("insert into public.jobs") && body.includes("provider_registry"),
    );

    expect(sql).toMatch(
      /enabled[\s\S]*authorization_status[\s\S]*authorized[\s\S]*writer_runtime[\s\S]*typescript/,
    );
    expect(sql).toMatch(
      /unique[\s\S]*schedule_id[\s\S]*scheduled_for|schedule_id[\s\S]*scheduled_for[\s\S]*unique/,
    );
    expect(sql).toMatch(/writer_runtime[\s\S]*(?:python|typescript)/);
    expect(scheduleFunction).toBeDefined();
    expect(scheduleFunction?.body).toMatch(
      /from public\.worker_schedules[\s\S]*for (?:no key )?update/,
    );
    expect(scheduleFunction?.body).toContain("worker_private.enqueue_run");
    expect(canonicalWriteFunction).toBeDefined();
    expect(canonicalWriteFunction?.body).toMatch(
      /from public\.provider_registry[\s\S]*for (?:no key )?update/,
    );
  });

  test("locks down every security-definer function", () => {
    const sql = foundationMigration().sql;
    const normalized = compact(sql);
    const functions = securityDefinerFunctions(sql);

    expect(functions.length).toBeGreaterThan(0);
    expect(normalized).toMatch(
      /security definer[\s\S]*set search_path\s*=\s*(?:pg_catalog|public)/,
    );
    expect(normalized).toMatch(/revoke all on all functions in schema worker_private from public/);
    expect(normalized).toMatch(/revoke all on all functions in schema worker_private from anon/);
    expect(normalized).toMatch(
      /revoke all on all functions in schema worker_private from authenticated/,
    );
    expect(normalized).toMatch(/grant execute on function[\s\S]*worker/);
    expect(normalized).toMatch(/grant execute on function[\s\S]*operator/);
    expect(normalized).toMatch(
      /revoke[\s\S]*(?:anon|authenticated|public)[\s\S]*(?:worker_tasks|provider_registry)/,
    );
  });
});
