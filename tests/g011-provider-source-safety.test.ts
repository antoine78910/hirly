import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repoRoot, "backend", "db", "migrations");
const sourceBoundaryMigrationName =
  "20260720000600_typescript_ingestion_source_boundary.sql";
const ownershipEpochMigrationName =
  "20260720000700_provider_ownership_epochs.sql";

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function forwardMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => name >= sourceBoundaryMigrationName)
    .sort()
    .map((name) => ({
      name,
      sql: read(`backend/db/migrations/${name}`),
    }));
}

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...productionTypeScriptFiles(path));
    } else if (
      [".ts", ".tsx"].includes(extname(entry)) &&
      !entry.endsWith(".test.ts")
    ) {
      files.push(path);
    }
  }
  return files;
}

function withoutRoutineBodies(sql: string): string {
  return sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "");
}

function withoutFreshFranceTravailOwnerSeed(sql: string): string {
  return sql.replace(
    /INSERT INTO public\.provider_registry \([\s\S]*?'france_travail'[\s\S]*?ON CONFLICT \(provider\) DO NOTHING;/,
    "",
  );
}

describe("G011 provider and source safety contract", () => {
  test("retains provider_registry as the only writer ownership authority", () => {
    const sourceBoundary = read(
      `backend/db/migrations/${sourceBoundaryMigrationName}`,
    );
    expect(sourceBoundary).toContain("registry.writer_runtime = 'typescript'");

    for (const { name, sql } of forwardMigrations()) {
      const migrationCommands = withoutFreshFranceTravailOwnerSeed(
        withoutRoutineBodies(sql),
      );
      expect(
        migrationCommands,
        `${name} must not transfer provider ownership while applying`,
      ).not.toMatch(
        /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?provider_registry\b/i,
      );

      for (const tableDefinition of sql.matchAll(
        /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
      )) {
        if (tableDefinition[1] === "provider_registry") continue;
        expect(
          tableDefinition[2],
          `${name} must not create a second writer ownership field`,
        ).not.toMatch(/\bwriter_runtime\b/i);
      }

      if (name > ownershipEpochMigrationName) {
        expect(
          sql,
          `${name} must not add a connector-specific provider ownership writer`,
        ).not.toMatch(
          /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?provider_registry\b/i,
        );
      }
    }
    const ownershipMigration = read(
      `backend/db/migrations/${ownershipEpochMigrationName}`,
    );
    expect(ownershipMigration).toMatch(
      /'france_travail', 'official-api', 'unverified', NULL,\s*false, 'python'/,
    );
    expect(ownershipMigration).toContain("0, false");
    expect(ownershipMigration).toContain("ON CONFLICT (provider) DO NOTHING");
  });

  test("retains the complete source-policy activation gate", () => {
    const sourceBoundary = read(
      `backend/db/migrations/${sourceBoundaryMigrationName}`,
    );
    const runnableFunction = sourceBoundary.match(
      /CREATE OR REPLACE FUNCTION worker_private\.career_source_runnable\([\s\S]*?\n\$\$;/,
    )?.[0];

    expect(runnableFunction).toBeDefined();
    for (const predicate of [
      "source.enabled",
      "source.transport_enabled",
      "source.incremental_enabled",
      "source.backfill_enabled",
      "registry.enabled",
      "registry.authorization_status = 'authorized'",
      "registry.writer_runtime = 'typescript'",
      "policy.enabled",
      "policy.approval_status = 'approved'",
      "policy.commercial_use_allowed",
      "policy.redisplay_allowed",
      "policy.full_text_retention_allowed",
      "'production' = ANY(policy.enabled_environments)",
      "source.access_type = ANY(policy.permitted_access_methods)",
      "policy.expires_at > clock_timestamp()",
    ]) {
      expect(
        runnableFunction,
        `career source activation must retain ${predicate}`,
      ).toContain(predicate);
    }
  });

  test("keeps connector transports and source seeds disabled by default", () => {
    const ingestionContract = read("packages/ingestion/src/index.ts");
    expect(ingestionContract).toMatch(
      /interface SourceAdapter[\s\S]*?readonly enabled: false;/,
    );
    expect(ingestionContract).toMatch(
      /interface SourceAdapter[\s\S]*?readonly liveTransportReady: false;/,
    );

    for (const { name, sql } of forwardMigrations()) {
      const migrationCommands = withoutRoutineBodies(sql);
      expect(
        migrationCommands,
        `${name} must not activate a source during migration`,
      ).not.toMatch(
        /\b(?:UPDATE|DELETE\s+FROM)\s+(?:public\.)?career_sources\b/i,
      );
      expect(
        migrationCommands,
        `${name} source seeds must inherit every disabled default`,
      ).not.toMatch(
        /\bINSERT\s+INTO\s+(?:public\.)?career_sources\s*\([^)]*\b(?:enabled|transport_enabled|incremental_enabled|backfill_enabled)\b/i,
      );
    }

    const connectorImplementations = [
      join(repoRoot, "apps", "worker", "src"),
      join(repoRoot, "packages", "ingestion", "src"),
    ]
      .flatMap(productionTypeScriptFiles)
      .filter((path) => {
        const contents = readFileSync(path, "utf8");
        return /\b(?:implements|satisfies)\s+SourceAdapter\b|:\s*SourceAdapter(?:<[^>]+>)?\s*=/.test(
          contents,
        );
      });

    for (const path of connectorImplementations) {
      const contents = readFileSync(path, "utf8");
      const displayPath = relative(repoRoot, path);
      expect(contents, `${displayPath} must be disabled`).toMatch(
        /\benabled\s*(?::\s*false\s*)?=\s*false\b|\benabled\s*:\s*false\b/,
      );
      expect(contents, `${displayPath} must not expose a live transport`).toMatch(
        /\bliveTransportReady\s*(?::\s*false\s*)?=\s*false\b|\bliveTransportReady\s*:\s*false\b/,
      );
    }
  });
});
