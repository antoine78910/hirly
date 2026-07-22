import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createJsonLogger } from "../packages/observability/src/index";
import { createDatabase, WorkerRepository } from "../packages/db/src/index";
import { PostgresRuntimeStore } from "../apps/worker/src/runtime/store";
import { createTaskHandlers } from "../apps/worker/src/runtime/handlers";
import { Consumer } from "../apps/worker/src/runtime/consumer";
import { providerModules } from "../apps/worker/src/providers";
import type { ProviderCore } from "../apps/worker/src/providers/core";
import type { Provider } from "../packages/contracts/src/index";
import { stableJobId } from "../packages/ingestion/src/index";

const databaseUrl = process.env.G004_TEST_DATABASE_URL ?? process.env.G002_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(sql: string): Promise<string> {
  if (!databaseUrl) throw new Error("G004_TEST_DATABASE_URL is required");
  const process = Bun.spawn(
    ["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-c", sql],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout.trim();
}

async function applyFile(relativePath: string): Promise<void> {
  if (!databaseUrl) throw new Error("G004_TEST_DATABASE_URL is required");
  const process = Bun.spawn(
    ["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-q", "-f", join(repoRoot, relativePath)],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to apply ${relativePath}: ${stderr}`);
  }
}

function foundationMigrationPath(): string {
  const directory = join(repoRoot, "backend", "db", "migrations");
  const migration = readdirSync(directory).find(
    (name) => name.endsWith("_typescript_worker_foundation.sql") && !name.endsWith(".down.sql"),
  );
  if (!migration) throw new Error("worker foundation migration is missing");
  return join("backend", "db", "migrations", migration);
}

function runtimeMigrationPath(): string {
  const directory = join(repoRoot, "backend", "db", "migrations");
  const migration = readdirSync(directory).find(
    (name) => name.endsWith("_bun_worker_runtime.sql") && !name.endsWith(".down.sql"),
  );
  if (!migration) throw new Error("worker runtime migration is missing");
  return join("backend", "db", "migrations", migration);
}

function providerOwnershipMigrationPath(): string {
  const directory = join(repoRoot, "backend", "db", "migrations");
  const migration = readdirSync(directory).find(
    (name) => name.endsWith("_provider_ownership_epochs.sql") && !name.endsWith(".down.sql"),
  );
  if (!migration) throw new Error("provider ownership migration is missing");
  return join("backend", "db", "migrations", migration);
}

async function resetFixtures(): Promise<void> {
  await psql(`
    SET session_replication_role = replica;
    DELETE FROM public.worker_task_attempts
    WHERE task_id IN (
      SELECT task.id
      FROM public.worker_tasks AS task
      JOIN public.worker_runs AS run ON run.id = task.run_id
      WHERE run.idempotency_key LIKE 'g004:postgres:%'
    );
    DELETE FROM public.worker_tasks
    WHERE run_id IN (
      SELECT id FROM public.worker_runs
      WHERE idempotency_key LIKE 'g004:postgres:%'
    );
    DELETE FROM public.worker_runs
    WHERE idempotency_key LIKE 'g004:postgres:%';
    DELETE FROM public.jobs
    WHERE provider = 'apec' AND external_id = 'apec-postgres-001';
    SET session_replication_role = DEFAULT;
  `);
}

if (databaseUrl) {
  beforeAll(async () => {
    await applyFile("backend/db/jobs_inventory_schema.sql");
    await psql(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
        ) THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END
      $$;
    `);
    await applyFile(foundationMigrationPath());
    await applyFile(runtimeMigrationPath());
    await applyFile("backend/db/migrations/20260720000500_job_dedup_linkage.sql");
    await applyFile(providerOwnershipMigrationPath());
    await resetFixtures();
  });

  afterAll(resetFixtures);
}

describe("G004 real-Postgres Consumer/runtime boundary", () => {
  runIntegration(
    "repeats fixture ingestion idempotently and reads back one canonical row",
    async () => {
      if (!databaseUrl) throw new Error("G004_TEST_DATABASE_URL is required");
      const fixture = {
        schemaVersion: "hirly.provider-fixture.v1" as const,
        provenance: {
          kind: "synthetic_sanitized" as const,
          approvalRef: ".omx/plans/prd-nextjs-bun-foundation.md#phase-4" as const,
          containsPersonalData: false as const,
        },
        provider: "apec" as const,
        externalId: "apec-postgres-001",
        title: "Postgres Runtime Engineer",
        company: "Example SAS",
        location: "Paris, Île-de-France",
        countryCode: "FR",
        description: "Synthetic runtime-boundary fixture.",
        contractType: "CDI",
        status: "open",
        applyUrls: ["https://boards.greenhouse.io/example/jobs/postgres"],
        sourceDocument: { fixture: "g004-postgres-runtime" },
      };
      const database = createDatabase(databaseUrl);
      const repository = new WorkerRepository(database);
      await repository.setProviderAuthorization({
        provider: "apec",
        status: "authorized",
        evidenceRef: "g004-test-fixture",
        reviewedAt: new Date("2026-07-20T00:00:00.000Z"),
      });
      await repository.setProviderWriter("apec", "typescript");
      await repository.setProviderEnabled("apec", true);

      for (const suffix of ["first", "repeat"]) {
        await repository.enqueue({
          kind: "provider_ingestion",
          provider: "apec",
          idempotencyKey: `g004:postgres:${suffix}`,
          triggerSource: "system",
          scheduleId: null,
          scheduledFor: null,
          tasks: [
            {
              taskKey: `g004-postgres-${suffix}`,
              taskType: "provider.fetch_page",
              payload: {
                query: "engineering",
                location: "France",
                countryCode: "FR",
                cursor: null,
                pageSize: 50,
                maxPages: 1,
              },
              maxAttempts: 2,
            },
          ],
        });
      }

      const store = new PostgresRuntimeStore(repository);
      const modules = {
        ...providerModules,
        apec: {
          ...providerModules.apec,
          rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
          transport: {
            async fetch() {
              return { items: [fixture], nextCursor: null };
            },
          },
        },
      } as unknown as Record<Provider, ProviderCore<unknown>>;
      const logLines: string[] = [];
      const logger = createJsonLogger((line) => logLines.push(line));
      const consumer = new Consumer(
        repository,
        createTaskHandlers(store, logger, modules),
        logger,
        {
          concurrency: 2,
          leaseSeconds: 30,
          heartbeatSeconds: 5,
          pollMs: 5,
          instanceId: "g004-postgres-worker",
          serviceVersion: "test",
          environment: "test",
        },
      );

      consumer.start();
      const deadline = Date.now() + 5_000;
      while (
        Number(
          await psql(`
            SELECT count(*)
            FROM public.worker_tasks AS task
            JOIN public.worker_runs AS run ON run.id = task.run_id
            WHERE run.idempotency_key LIKE 'g004:postgres:%'
              AND task.status = 'succeeded';
          `),
        ) < 2
      ) {
        if (Date.now() >= deadline) {
          throw new Error(`consumer timed out: ${logLines.join("\n")}`);
        }
        await Bun.sleep(20);
      }
      await consumer.stop(500);

      expect(
        await psql(`
          SELECT count(*)
          FROM public.jobs
          WHERE provider = 'apec'
            AND external_id = 'apec-postgres-001';
        `),
      ).toBe("1");
      expect(
        await psql(`
          SELECT job_id
          FROM public.jobs
          WHERE provider = 'apec'
            AND external_id = 'apec-postgres-001';
        `),
      ).toBe(stableJobId("apec", "apec-postgres-001"));

      await repository.close();
    },
    15_000,
  );

  test("is opt-in outside a disposable Postgres service", () => {
    if (!databaseUrl) expect(databaseUrl).toBeUndefined();
  });
});
