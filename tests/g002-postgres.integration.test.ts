import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = process.env.G002_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

type SqlResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function psql(sql: string): Promise<SqlResult> {
  if (!databaseUrl) {
    throw new Error("G002_TEST_DATABASE_URL is required");
  }
  const process = Bun.spawn(
    [
      "psql",
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-q",
      "-c",
      sql,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function applyFile(relativePath: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error("G002_TEST_DATABASE_URL is required");
  }
  const process = Bun.spawn(
    [
      "psql",
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-f",
      join(repoRoot, relativePath),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to apply ${relativePath}: ${stderr}`);
  }
}

function migrationPath(): string {
  const directory = join(repoRoot, "backend", "db", "migrations");
  const migration = readdirSync(directory).find(
    (name) =>
      name.endsWith("_typescript_worker_foundation.sql") &&
      !name.endsWith(".down.sql"),
  );
  if (!migration) {
    throw new Error("TypeScript worker foundation migration is missing");
  }
  return join("backend", "db", "migrations", migration);
}

async function assertSql(sql: string): Promise<string> {
  const result = await psql(sql);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout;
}

async function resetFixtureState(): Promise<void> {
  await assertSql(`
    TRUNCATE public.worker_task_attempts, public.worker_tasks,
      public.worker_runs, public.worker_schedules RESTART IDENTITY CASCADE;
    DELETE FROM public.jobs WHERE provider = 'apec' AND external_id LIKE 'g002-%';
    UPDATE public.provider_registry
    SET authorization_status = 'authorized',
        authorization_evidence_ref = 'test-fixture',
        authorization_reviewed_at = clock_timestamp(),
        enabled = true,
        writer_runtime = 'typescript'
    WHERE provider = 'apec';
  `);
}

function claimedCount(output: string): number {
  const count = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line === "0" || line === "1");
  if (count === undefined) {
    throw new Error(`Claim count missing from psql output: ${output}`);
  }
  return Number(count);
}

if (databaseUrl) {
  beforeAll(async () => {
    await applyFile("backend/db/jobs_inventory_schema.sql");
    await applyFile(migrationPath());
  });

  afterAll(async () => {
    await resetFixtureState();
  });
}

describe("G002 real-Postgres durability and security", () => {
  runIntegration("allows exactly one claimant across competing connections", async () => {
    await resetFixtureState();
    await assertSql(`
      SELECT worker_private.enqueue_run(
        'inventory_maintenance', NULL, 'g002:race', 'system',
        'only-task', 'inventory.maintenance', '{}'::jsonb
      );
    `);

    const claim = (owner: string) =>
      psql(`
        BEGIN;
        SELECT count(*) FROM worker_private.claim_tasks('${owner}', 1, 30);
        SELECT pg_sleep(0.5);
        COMMIT;
      `);
    const [first, second] = await Promise.all([
      claim("worker-a"),
      claim("worker-b"),
    ]);

    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(
      [claimedCount(first.stdout), claimedCount(second.stdout)].sort(),
    ).toEqual([0, 1]);
    expect(
      await assertSql(`
        SELECT count(*) FROM public.worker_tasks WHERE status = 'running';
      `),
    ).toBe("1");
  });

  runIntegration("reclaims an expired lease with a new fence and closes history", async () => {
    await resetFixtureState();
    await assertSql(`
      SELECT worker_private.enqueue_run(
        'inventory_maintenance', NULL, 'g002:reclaim', 'system',
        'reclaim-task', 'inventory.maintenance', '{}'::jsonb
      );
      SELECT count(*) FROM worker_private.claim_tasks('stale-worker', 1, 30);
      UPDATE public.worker_tasks
      SET lease_until = clock_timestamp() - interval '1 second'
      WHERE task_key = 'reclaim-task';
      SELECT count(*) FROM worker_private.claim_tasks('current-worker', 1, 30);
    `);

    const state = await assertSql(`
      SELECT attempts, claim_generation, lease_owner
      FROM public.worker_tasks WHERE task_key = 'reclaim-task';
    `);
    expect(state).toBe("2|2|current-worker");
    expect(
      await assertSql(`
        SELECT attempt_number, outcome, finished_at IS NOT NULL
        FROM public.worker_task_attempts
        WHERE task_id = (
          SELECT id FROM public.worker_tasks WHERE task_key = 'reclaim-task'
        )
        ORDER BY attempt_number;
      `),
    ).toBe("1|lease_expired|t\n2||f");

    expect(
      await assertSql(`
        SELECT worker_private.finish_task(
          task.id,
          attempt.lease_token,
          attempt.claim_generation,
          attempt.lease_owner,
          'succeeded'
        )
        FROM public.worker_tasks AS task
        JOIN public.worker_task_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.attempt_number = 1
        WHERE task.task_key = 'reclaim-task';
      `),
    ).toBe("f");
  });

  runIntegration("blocks stale or unauthorized canonical writes", async () => {
    await resetFixtureState();
    await assertSql(`
      SELECT worker_private.enqueue_run(
        'provider_ingestion', 'apec', 'g002:blocked-write', 'system',
        'provider-task', 'provider.fetch_page', '{}'::jsonb
      );
      SELECT count(*) FROM worker_private.claim_tasks('provider-worker', 1, 30);
      SELECT worker_private.set_provider_authorization(
        'apec', 'blocked', 'test-downgrade', clock_timestamp()
      );
    `);

    const blockedWrite = await psql(`
      SELECT worker_private.write_job_and_complete(
        task.id, task.lease_token, task.claim_generation, task.lease_owner,
        jsonb_build_object(
          'job_id', 'job_e7a6cf106d509bec',
          'provider', 'apec',
          'external_id', 'g002-blocked',
          'title', 'Engineer',
          'normalized_title', 'engineer',
          'company', 'Hirly',
          'normalized_company', 'hirly',
          'location', 'Paris',
          'country_code', 'FR',
          'selected_apply_url', 'https://example.com/apply',
          'validation_status', 'valid',
          'applyability_tier', 'direct_ats',
          'manual_fulfillment_ready', true,
          'auto_apply_supported', true,
          'fingerprint', 'g002',
          'data', '{}'::jsonb
        )
      )
      FROM public.worker_tasks AS task
      WHERE task.task_key = 'provider-task';
    `);
    expect(blockedWrite.exitCode).not.toBe(0);
    expect(blockedWrite.stderr).toContain(
      "provider authorization or writer ownership changed",
    );
    expect(
      await assertSql(`
        SELECT count(*) FROM public.jobs
        WHERE provider = 'apec' AND external_id = 'g002-blocked';
      `),
    ).toBe("0");
  });

  runIntegration("denies client/read roles and direct queue mutation", async () => {
    await resetFixtureState();

    const readerClaim = await psql(`
      SET ROLE hirly_inventory_reader;
      SELECT count(*) FROM worker_private.claim_tasks('reader', 1, 30);
    `);
    expect(readerClaim.exitCode).not.toBe(0);
    expect(readerClaim.stderr).toContain("permission denied");

    const workerMutation = await psql(`
      SET ROLE hirly_inventory_worker;
      UPDATE public.worker_tasks SET status = 'cancelled';
    `);
    expect(workerMutation.exitCode).not.toBe(0);
    expect(workerMutation.stderr).toContain("permission denied");

    for (const role of ["anon", "authenticated"]) {
      const roleExists = await assertSql(
        `SELECT count(*) FROM pg_roles WHERE rolname = '${role}';`,
      );
      if (roleExists === "1") {
        const clientClaim = await psql(`
          SET ROLE ${role};
          SELECT count(*) FROM worker_private.claim_tasks('client', 1, 30);
        `);
        expect(clientClaim.exitCode).not.toBe(0);
        expect(clientClaim.stderr).toContain("permission denied");
      }
    }
  });
});

test("G002 real-Postgres suite is opt-in outside CI service setup", () => {
  if (!databaseUrl) {
    expect(readFileSync(join(repoRoot, "backend", "db", "jobs_inventory_schema.sql"), "utf8"))
      .toContain("CREATE TABLE IF NOT EXISTS jobs");
  } else {
    expect(databaseUrl).toMatch(/^postgres(?:ql)?:\/\//);
  }
});
