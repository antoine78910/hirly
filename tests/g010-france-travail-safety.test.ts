import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DisabledSourceTransport } from "../packages/ingestion/src";

const repoRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repoRoot, "backend", "db", "migrations");
const sourceBoundaryMigrationName = "20260720000600_typescript_ingestion_source_boundary.sql";

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function guardedForwardMigrations(): Array<{
  name: string;
  sql: string;
}> {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => name >= sourceBoundaryMigrationName)
    .sort()
    .map((name) => ({
      name,
      sql: read(`backend/db/migrations/${name}`),
    }));
}

function sqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function withoutRoutineBodies(sql: string): string {
  return sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "");
}

describe("G010 France Travail production safety contract", () => {
  test("keeps provider_registry.writer_runtime as the single writer authority", () => {
    const foundation = read(
      "backend/db/migrations/20260720000100_typescript_worker_foundation.sql",
    );

    expect(foundation).toContain("writer_runtime text NOT NULL DEFAULT 'none'");
    expect(foundation).toContain("writer_runtime IN ('none', 'python', 'typescript')");

    for (const { name, sql } of guardedForwardMigrations()) {
      const migrationCommands = withoutRoutineBodies(sql);
      const commandsWithoutFreshFranceTravailSeed = migrationCommands.replace(
        /INSERT INTO public\.provider_registry \([\s\S]*?'france_travail'[\s\S]*?ON CONFLICT \(provider\) DO NOTHING;/,
        "",
      );
      expect(
        commandsWithoutFreshFranceTravailSeed,
        `${name} must not transfer existing provider writer ownership while applying`,
      ).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?provider_registry\b/i);

      for (const tableDefinition of sql.matchAll(
        /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
      )) {
        if (tableDefinition[1] === "provider_registry") continue;
        expect(
          tableDefinition[2],
          `${name} must not create a second writer-runtime authority`,
        ).not.toMatch(/\bwriter_runtime\b/i);
      }

      if (/\b(?:ownership_epoch|writer_claim)\b/i.test(sql)) {
        expect(sql, `${name} ownership fencing must use provider_registry`).toMatch(
          /\bprovider_registry\b/i,
        );
        expect(sql, `${name} ownership fencing must validate writer_runtime`).toMatch(
          /\bwriter_runtime\b/i,
        );
      }
    }

    const sourceBoundary = read(`backend/db/migrations/${sourceBoundaryMigrationName}`);
    expect(sourceBoundary).toContain("registry.writer_runtime = 'typescript'");
    const ownershipMigration = read(
      "backend/db/migrations/20260720000700_provider_ownership_epochs.sql",
    );
    expect(ownershipMigration).toMatch(
      /'france_travail', 'official-api', 'unverified', NULL,\s*false, 'python'/,
    );
    expect(ownershipMigration).toContain("0, false");
    expect(ownershipMigration).toContain("ON CONFLICT (provider) DO NOTHING");
  });

  test("keeps all TypeScript source transports and modes disabled by default", async () => {
    const sourceBoundary = read(`backend/db/migrations/${sourceBoundaryMigrationName}`);

    for (const disabledDefault of [
      "transport_enabled boolean NOT NULL DEFAULT false",
      "incremental_enabled boolean NOT NULL DEFAULT false",
      "backfill_enabled boolean NOT NULL DEFAULT false",
    ]) {
      expect(sourceBoundary).toContain(disabledDefault);
    }

    for (const { name, sql } of guardedForwardMigrations()) {
      const migrationCommands = withoutRoutineBodies(sql);
      expect(
        migrationCommands,
        `${name} must not mutate a source into an active state while applying`,
      ).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM)\s+(?:public\.)?career_sources\b/i);
      expect(
        migrationCommands,
        `${name} source seeds must inherit disabled column defaults`,
      ).not.toMatch(
        /\bINSERT\s+INTO\s+(?:public\.)?career_sources\s*\([^)]*\b(?:enabled|transport_enabled|incremental_enabled|backfill_enabled)\b/i,
      );
    }

    const transport = new DisabledSourceTransport<unknown>();
    expect(transport.liveTransportReady).toBeFalse();
    await expect(
      transport.fetch(
        {
          provider: "france_travail",
          sourceId: "11111111-1111-4111-8111-111111111111",
          sourceKey: "france-travail",
          tenantKey: null,
          countryCode: "FR",
          mode: "dry_run",
          checkpoint: {},
          pageSize: 100,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "authorization_blocked",
    });
  });

  test("keeps legacy jobs reads additive and backward compatible", () => {
    for (const { name, sql } of guardedForwardMigrations()) {
      expect(sql, `${name} must retain the public.jobs table`).not.toMatch(
        /\bDROP\s+(?:TABLE\s+)?(?:IF\s+EXISTS\s+)?public\.jobs\b/i,
      );
      expect(sql, `${name} must retain backward-compatible public.jobs reads`).not.toMatch(
        /\bREVOKE\s+(?:ALL|SELECT)\s+ON\s+(?:TABLE\s+)?public\.jobs\b/i,
      );

      for (const statement of sqlStatements(sql).filter((candidate) =>
        /\bALTER\s+TABLE\s+public\.jobs\b/i.test(candidate),
      )) {
        expect(statement, `${name} must not remove or rewrite existing jobs columns`).not.toMatch(
          /\b(?:DROP\s+COLUMN|RENAME\s+COLUMN|ALTER\s+COLUMN)\b/i,
        );
      }
    }
  });

  test("does not commit credentials or production activation", () => {
    const credentialAssignment =
      /^(?:FRANCE_TRAVAIL_(?:ACCESS_TOKEN|CLIENT_ID|CLIENT_SECRET)|JOB_PROVIDER_PRIMARY|FRANCE_TRAVAIL_HARVEST_ENABLED)=(.+)$/gm;
    const environmentTemplates = ["backend/.env.example", "frontend/.env.example"];

    for (const path of environmentTemplates) {
      const contents = read(path);
      for (const match of contents.matchAll(credentialAssignment)) {
        expect(
          match[1]?.trim(),
          `${path} must not contain a live credential or activation value`,
        ).toBe("");
      }
    }

    for (const { name, sql } of guardedForwardMigrations()) {
      expect(sql, `${name} must not embed France Travail credentials`).not.toMatch(
        /\bFRANCE_TRAVAIL_(?:ACCESS_TOKEN|CLIENT_ID|CLIENT_SECRET)\s*=\s*['"][^'"]+['"]/i,
      );
    }
  });
});
