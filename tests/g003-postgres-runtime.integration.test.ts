import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  createDatabase,
  WorkerRepository,
} from "../packages/db/src/index";

const databaseUrl =
  process.env.G003_TEST_DATABASE_URL ?? process.env.G002_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

type SqlResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function psql(sql: string): Promise<SqlResult> {
  if (!databaseUrl) {
    throw new Error("G003_TEST_DATABASE_URL is required");
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
    throw new Error("G003_TEST_DATABASE_URL is required");
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

function runtimeMigrationPath(): string {
  const directory = join(repoRoot, "backend", "db", "migrations");
  const migration = readdirSync(directory).find(
    (name) =>
      name.endsWith("_bun_worker_runtime.sql") && !name.endsWith(".down.sql"),
  );
  if (!migration) {
    throw new Error("Bun worker runtime migration is missing");
  }
  return join("backend", "db", "migrations", migration);
}

async function assertSql(sql: string): Promise<string> {
  const result = await psql(sql);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout;
}

async function resetG003Fixtures(): Promise<void> {
  await assertSql(`
    DELETE FROM public.worker_task_attempts
    WHERE task_id IN (
      SELECT task.id
      FROM public.worker_tasks AS task
      JOIN public.worker_runs AS run ON run.id = task.run_id
      WHERE run.idempotency_key LIKE 'g003:%'
    );
    DELETE FROM public.worker_tasks
    WHERE run_id IN (
      SELECT id FROM public.worker_runs WHERE idempotency_key LIKE 'g003:%'
    );
    DELETE FROM public.worker_runs WHERE idempotency_key LIKE 'g003:%';
    DELETE FROM public.worker_schedules WHERE id LIKE 'g003-%';
  `);
}

async function seedRuntimeFixtures(): Promise<string> {
  await resetG003Fixtures();
  await assertSql(`
    SELECT worker_private.upsert_schedule(
      'g003-due',
      'inventory.maintenance',
      NULL,
      '* * * * *',
      'UTC',
      '{}'::jsonb,
      clock_timestamp() - interval '5 minutes',
      3
    );
    SELECT worker_private.set_schedule_enabled(
      'g003-due',
      true,
      clock_timestamp() - interval '5 minutes'
    );
    SELECT worker_private.upsert_schedule(
      'g003-disabled',
      'inventory.maintenance',
      NULL,
      '* * * * *',
      'UTC',
      '{}'::jsonb,
      clock_timestamp() - interval '5 minutes',
      1
    );
    SELECT worker_private.upsert_schedule(
      'g003-future',
      'inventory.maintenance',
      NULL,
      '* * * * *',
      'UTC',
      '{}'::jsonb,
      clock_timestamp() + interval '1 hour',
      1
    );
    SELECT worker_private.set_schedule_enabled(
      'g003-future',
      true,
      clock_timestamp() + interval '1 hour'
    );
  `);
  return assertSql(`
    SELECT id
    FROM worker_private.enqueue_run(
      'inventory_maintenance',
      NULL,
      'g003:redacted-run',
      'system',
      'g003-redacted-task',
      'inventory.maintenance',
      jsonb_build_object(
        'payload_secret',
        'must-never-leave-the-private-task-table'
      )
    );
  `);
}

if (databaseUrl) {
  beforeAll(async () => {
    await applyFile("backend/db/jobs_inventory_schema.sql");
    await applyFile(migrationPath());
    await applyFile(runtimeMigrationPath());
  });

  afterAll(async () => {
    await resetG003Fixtures();
  });
}

describe("G003 least-privilege runtime repository", () => {
  runIntegration(
    "recovers an expired lease after process restart and fences the stale attempt",
    async () => {
      await resetG003Fixtures();
      await assertSql(`
        SELECT worker_private.enqueue_run(
          'inventory_maintenance',
          NULL,
          'g003:restart-recovery',
          'system',
          'g003-restart-task',
          'inventory.maintenance',
          '{}'::jsonb
        );
        SELECT count(*)
        FROM worker_private.claim_tasks('crashed-worker', 1, 30);
        UPDATE public.worker_tasks
        SET lease_until = clock_timestamp() - interval '1 second'
        WHERE task_key = 'g003-restart-task';
        SELECT count(*)
        FROM worker_private.claim_tasks('restarted-worker', 1, 30);
      `);

      expect(
        await assertSql(`
          SELECT attempts, claim_generation, lease_owner
          FROM public.worker_tasks
          WHERE task_key = 'g003-restart-task';
        `),
      ).toBe("2|2|restarted-worker");
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
            ON attempt.task_id = task.id
           AND attempt.attempt_number = 1
          WHERE task.task_key = 'g003-restart-task';
        `),
      ).toBe("f");
      expect(
        await assertSql(`
          SELECT attempt_number, outcome
          FROM public.worker_task_attempts
          WHERE task_id = (
            SELECT id
            FROM public.worker_tasks
            WHERE task_key = 'g003-restart-task'
          )
          ORDER BY attempt_number;
        `),
      ).toBe("1|lease_expired\n2|");
    },
  );

  runIntegration(
    "discovers only due enabled schedules through the worker function",
    async () => {
      await seedRuntimeFixtures();
      const sql = createDatabase(databaseUrl!, { max: 1 });
      try {
        await sql`SET ROLE hirly_inventory_worker`;
        const repository = new WorkerRepository(sql);
        const schedules = await repository.listDueSchedules(10);

        expect(schedules.map(({ id }) => id)).toEqual(["g003-due"]);
        expect(schedules[0]).toMatchObject({
          id: "g003-due",
          cronExpression: "* * * * *",
          timezone: "UTC",
          maxCatchUp: 3,
        });
        expect(schedules[0]?.nextDueAt).toBeInstanceOf(Date);
        expect(schedules[0]?.databaseNow).toBeInstanceOf(Date);
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  );

  runIntegration(
    "enqueues one persisted occurrence and rejects stale schedule replay",
    async () => {
      await seedRuntimeFixtures();
      const sql = createDatabase(databaseUrl!, { max: 1 });
      try {
        await sql`SET ROLE hirly_inventory_worker`;
        const repository = new WorkerRepository(sql);
        const [schedule] = await repository.listDueSchedules(10);
        expect(schedule).toBeDefined();
        const successor = new Date(schedule!.nextDueAt);
        successor.setUTCSeconds(0, 0);
        successor.setUTCMinutes(successor.getUTCMinutes() + 1);

        const first = await repository.enqueueDueSchedule(
          schedule!.id,
          successor,
        );
        await expect(
          repository.enqueueDueSchedule(schedule!.id, successor),
        ).rejects.toThrow(
          "next due time must advance",
        );

        expect(first).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(
          await assertSql(`
            SELECT count(*)
            FROM public.worker_runs
            WHERE schedule_id = 'g003-due';
          `),
        ).toBe("1");
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  );

  runIntegration(
    "returns a redacted RunView without granting table reads",
    async () => {
      const runId = await seedRuntimeFixtures();
      await assertSql(`
        UPDATE public.worker_runs
        SET summary = jsonb_build_object(
          'accepted', 3,
          'payload', 'must-never-leave',
          'authorization', 'Bearer must-never-leave',
          'nested', jsonb_build_object('token', 'must-never-leave')
        )
        WHERE id = '${runId}'::uuid;
      `);
      const sql = createDatabase(databaseUrl!, { max: 1 });
      try {
        await sql`SET ROLE hirly_inventory_worker`;
        const repository = new WorkerRepository(sql);
        const run = await repository.getRun(runId);
        const serialized = JSON.stringify(run);

        expect(run).toMatchObject({
          id: runId,
          kind: "inventory_maintenance",
          provider: null,
          triggerSource: "system",
          status: "queued",
        });
        expect(run?.summary).toEqual(expect.any(Object));
        expect(serialized).not.toContain("payload_secret");
        expect(serialized).not.toContain("must-never-leave");
        expect(serialized).not.toContain("idempotency");
        expect(serialized).not.toContain("lease");
      } finally {
        await sql.end({ timeout: 1 });
      }

      const directRead = await psql(`
        SET ROLE hirly_inventory_worker;
        SELECT payload FROM public.worker_tasks LIMIT 1;
      `);
      expect(directRead.exitCode).not.toBe(0);
      expect(directRead.stderr).toContain("permission denied");
    },
  );

  runIntegration(
    "keeps discovery and run lookup unavailable to client roles",
    async () => {
      await seedRuntimeFixtures();
      for (const role of ["anon", "authenticated"]) {
        const roleExists = await assertSql(
          `SELECT count(*) FROM pg_roles WHERE rolname = '${role}';`,
        );
        if (roleExists !== "1") continue;

        for (const statement of [
          "SELECT count(*) FROM worker_private.list_due_schedules(10)",
          "SELECT count(*) FROM worker_private.get_run('00000000-0000-4000-8000-000000000000'::uuid)",
        ]) {
          const result = await psql(`SET ROLE ${role}; ${statement};`);
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toContain("permission denied");
        }
      }
    },
  );

  runIntegration(
    "fixes search_path and exposes only the documented redacted result shape",
    async () => {
      const metadata = await assertSql(`
        SELECT
          procedure.proname,
          pg_get_function_result(procedure.oid),
          EXISTS (
            SELECT 1
            FROM unnest(coalesce(procedure.proconfig, ARRAY[]::text[])) setting
            WHERE setting LIKE 'search_path=%'
          )
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'worker_private'
          AND procedure.proname IN ('list_due_schedules', 'get_run')
        ORDER BY procedure.proname;
      `);

      expect(metadata).toContain("get_run|");
      expect(metadata).toContain("list_due_schedules|");
      expect(metadata).toContain("|t");
      expect(metadata).not.toContain("payload");
      expect(metadata).not.toContain("idempotency");
      expect(metadata).not.toContain("lease_token");
      expect(
        await assertSql(`
          SELECT count(*)
          FROM pg_proc AS procedure
          JOIN pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          CROSS JOIN LATERAL aclexplode(
            coalesce(
              procedure.proacl,
              acldefault('f', procedure.proowner)
            )
          ) AS privilege
          WHERE namespace.nspname = 'worker_private'
            AND procedure.proname IN (
              'provider_runnable',
              'list_due_schedules',
              'get_run'
            )
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE';
        `),
      ).toBe("0");
    },
  );
});

test("G003 Postgres runtime suite is opt-in outside disposable CI services", () => {
  if (!databaseUrl) {
    expect(migrationPath()).toContain("typescript_worker_foundation.sql");
  } else {
    expect(databaseUrl).toMatch(/^postgres(?:ql)?:\/\//);
  }
});
