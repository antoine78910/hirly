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
    ["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-c", sql],
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
    ["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-q", "-f", join(repoRoot, relativePath)],
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
    (name) => name.endsWith("_typescript_worker_foundation.sql") && !name.endsWith(".down.sql"),
  );
  if (!migration) {
    throw new Error("TypeScript worker foundation migration is missing");
  }
  return join("backend", "db", "migrations", migration);
}

function rollbackPath(): string {
  return `${migrationPath().replace(/\.sql$/, "")}.down.sql`;
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

function canonicalJob(
  externalId: string,
  jobId: string,
  title = "Engineer",
): Record<string, unknown> {
  return {
    job_id: jobId,
    provider: "apec",
    external_id: externalId,
    title,
    normalized_title: title.toLowerCase(),
    company: "Hirly",
    normalized_company: "hirly",
    location: "Paris",
    country_code: "FR",
    selected_apply_url: "https://example.com/apply",
    validation_status: "valid",
    validation_reason: "fixture",
    validation_checked_at: "2026-07-20T00:00:00Z",
    applyability_tier: "direct_ats",
    applyability_score: 1,
    apply_fulfillment_status: "ready",
    apply_url_provider: "company",
    ats_provider: "greenhouse",
    requires_login: false,
    requires_account_creation: false,
    captcha_detected: false,
    manual_fulfillment_ready: true,
    auto_apply_supported: true,
    rejection_reason: null,
    fingerprint: `fingerprint:${externalId}`,
    data: { source: "g002-fixture" },
  };
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
    const [first, second] = await Promise.all([claim("worker-a"), claim("worker-b")]);

    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect([claimedCount(first.stdout), claimedCount(second.stdout)].sort()).toEqual([0, 1]);
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
    expect(
      await assertSql(`
        SELECT worker_private.heartbeat_task(
          task.id,
          attempt.lease_token,
          attempt.claim_generation,
          attempt.lease_owner,
          30
        )
        FROM public.worker_tasks AS task
        JOIN public.worker_task_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.attempt_number = 2
        WHERE task.task_key = 'reclaim-task';
      `),
    ).toBe("t");
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
          ON attempt.task_id = task.id AND attempt.attempt_number = 2
        WHERE task.task_key = 'reclaim-task';
      `),
    ).toBe("t");
    expect(
      await assertSql(`
        SELECT worker_private.heartbeat_task(
          task.id,
          attempt.lease_token,
          attempt.claim_generation,
          attempt.lease_owner,
          30
        )
        FROM public.worker_tasks AS task
        JOIN public.worker_task_attempts AS attempt
          ON attempt.task_id = task.id AND attempt.attempt_number = 2
        WHERE task.task_key = 'reclaim-task';
      `),
    ).toBe("f");
  });

  runIntegration("terminalizes an expired lease at max attempts", async () => {
    await resetFixtureState();
    await assertSql(`
      SELECT worker_private.enqueue_run(
        'inventory_maintenance', NULL, 'g002:exhausted', 'system',
        'exhausted-task', 'inventory.maintenance', '{}'::jsonb, 1
      );
      SELECT count(*) FROM worker_private.claim_tasks('last-worker', 1, 30);
      UPDATE public.worker_tasks
      SET lease_until = clock_timestamp() - interval '1 second'
      WHERE task_key = 'exhausted-task';
      SELECT count(*) FROM worker_private.claim_tasks('too-late', 1, 30);
    `);

    expect(
      await assertSql(`
        SELECT task.status, run.status, attempt.outcome,
          attempt.finished_at IS NOT NULL
        FROM public.worker_tasks AS task
        JOIN public.worker_runs AS run ON run.id = task.run_id
        JOIN public.worker_task_attempts AS attempt ON attempt.task_id = task.id
        WHERE task.task_key = 'exhausted-task';
      `),
    ).toBe("failed|failed|lease_expired|t");
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
    expect(blockedWrite.stderr).toContain("provider authorization or writer ownership changed");
    expect(
      await assertSql(`
        SELECT count(*) FROM public.jobs
        WHERE provider = 'apec' AND external_id = 'g002-blocked';
      `),
    ).toBe("0");
  });

  runIntegration("rejects a provider identity collision without overwriting", async () => {
    await resetFixtureState();
    await assertSql(`
      INSERT INTO public.jobs (
        job_id, provider, external_id, title, normalized_title, company,
        normalized_company, location, country_code, data
      )
      VALUES (
        'job_ffffffffffffffff', 'apec', 'g002-collision', 'Original',
        'original', 'Original Co', 'original co', 'Paris', 'FR', '{}'::jsonb
      );
      SELECT worker_private.enqueue_run(
        'provider_ingestion', 'apec', 'g002:collision', 'system',
        'collision-task', 'provider.fetch_page', '{}'::jsonb
      );
      SELECT count(*) FROM worker_private.claim_tasks('collision-worker', 1, 30);
    `);

    const collision = await psql(`
      SELECT worker_private.write_job_and_complete(
        task.id, task.lease_token, task.claim_generation, task.lease_owner,
        jsonb_build_object(
          'job_id', 'job_e7d8baba11672b9c',
          'provider', 'apec',
          'external_id', 'g002-collision',
          'title', 'Replacement',
          'normalized_title', 'replacement',
          'company', 'Replacement Co',
          'normalized_company', 'replacement co',
          'location', 'Paris',
          'country_code', 'FR',
          'selected_apply_url', 'https://example.com/apply',
          'validation_status', 'valid',
          'applyability_tier', 'direct_ats',
          'manual_fulfillment_ready', true,
          'auto_apply_supported', true,
          'fingerprint', 'g002-collision',
          'data', '{}'::jsonb
        )
      )
      FROM public.worker_tasks AS task
      WHERE task.task_key = 'collision-task';
    `);
    expect(collision.exitCode).not.toBe(0);
    expect(collision.stderr).toContain("existing provider identity maps to another job id");
    expect(
      await assertSql(`
        SELECT job_id, title FROM public.jobs
        WHERE provider = 'apec' AND external_id = 'g002-collision';
      `),
    ).toBe("job_ffffffffffffffff|Original");
    expect(
      await assertSql(`
        SELECT status FROM public.worker_tasks
        WHERE task_key = 'collision-task';
      `),
    ).toBe("running");
  });

  runIntegration("writes a canonical batch and task completion atomically", async () => {
    await resetFixtureState();
    await assertSql(`
      SELECT worker_private.enqueue_run(
        'provider_ingestion', 'apec', 'g002:batch', 'system',
        'batch-task', 'provider.fetch_page', '{}'::jsonb
      );
      SELECT count(*) FROM worker_private.claim_tasks('batch-worker', 1, 30);
    `);

    const validFirst = canonicalJob("g002-batch-1", "job_2635481a3f4a54e7", "First");
    const invalidSecond = canonicalJob("g002-batch-2", "job_0000000000000000", "Second");
    const rejectedBatch = await psql(`
      SELECT worker_private.write_jobs_and_complete(
        task.id, task.lease_token, task.claim_generation, task.lease_owner,
        '${JSON.stringify([validFirst, invalidSecond])}'::jsonb
      )
      FROM public.worker_tasks AS task
      WHERE task.task_key = 'batch-task';
    `);
    expect(rejectedBatch.exitCode).not.toBe(0);
    expect(rejectedBatch.stderr).toContain("deterministic job id mismatch");
    expect(
      await assertSql(`
        SELECT
          (SELECT count(*) FROM public.jobs
           WHERE provider = 'apec' AND external_id LIKE 'g002-batch-%'),
          (SELECT status FROM public.worker_tasks WHERE task_key = 'batch-task');
      `),
    ).toBe("0|running");

    const validSecond = canonicalJob("g002-batch-2", "job_5251dce1e263d0be", "Second");
    expect(
      await assertSql(`
        SELECT worker_private.write_jobs_and_complete(
          task.id, task.lease_token, task.claim_generation, task.lease_owner,
          '${JSON.stringify([validFirst, validSecond])}'::jsonb
        )
        FROM public.worker_tasks AS task
        WHERE task.task_key = 'batch-task';
      `),
    ).toBe("t");
    expect(
      await assertSql(`
        SELECT
          (SELECT count(*) FROM public.jobs
           WHERE provider = 'apec' AND external_id LIKE 'g002-batch-%'),
          (SELECT status FROM public.worker_tasks WHERE task_key = 'batch-task');
      `),
    ).toBe("2|succeeded");
  });

  runIntegration("serializes due-enqueue and schedule disable in both orders", async () => {
    await resetFixtureState();
    await assertSql(`
      INSERT INTO public.worker_schedules (
        id, task_type, provider, cron_expression, timezone, payload,
        enabled, next_due_at
      )
      VALUES (
        'g002-schedule', 'inventory.maintenance', NULL, '* * * * *', 'UTC',
        '{}'::jsonb, true, clock_timestamp() - interval '1 second'
      );
    `);
    const nextDue = new Date(Date.now() + 60_000).toISOString();
    const enqueue = () =>
      psql(`
        SELECT (worker_private.enqueue_due_schedule(
          'g002-schedule', '${nextDue}'::timestamptz
        )).id IS NOT NULL;
      `);
    const [firstScheduler, secondScheduler] = await Promise.all([enqueue(), enqueue()]);
    expect(firstScheduler.exitCode).toBe(0);
    expect(secondScheduler.exitCode).toBe(0);
    expect(
      await assertSql(`
        SELECT count(*) FROM public.worker_runs
        WHERE schedule_id = 'g002-schedule';
      `),
    ).toBe("1");

    await assertSql(`
      DELETE FROM public.worker_task_attempts;
      DELETE FROM public.worker_tasks;
      DELETE FROM public.worker_runs;
      UPDATE public.worker_schedules
      SET enabled = true, next_due_at = clock_timestamp() - interval '1 second'
      WHERE id = 'g002-schedule';
    `);
    const enqueueFirst = psql(`
      BEGIN;
      SELECT (worker_private.enqueue_due_schedule(
        'g002-schedule', '${nextDue}'::timestamptz
      )).id IS NOT NULL;
      SELECT pg_sleep(0.5);
      COMMIT;
    `);
    await Bun.sleep(50);
    const disableSecond = psql(`
      SELECT (worker_private.set_schedule_enabled(
        'g002-schedule', false, NULL
      )).enabled;
    `);
    const [enqueueFirstResult, disableSecondResult] = await Promise.all([
      enqueueFirst,
      disableSecond,
    ]);
    expect(enqueueFirstResult.exitCode, enqueueFirstResult.stderr).toBe(0);
    expect(disableSecondResult.exitCode, disableSecondResult.stderr).toBe(0);
    expect(
      await assertSql(`
        SELECT count(*), bool_and(NOT schedule.enabled)
        FROM public.worker_runs AS run
        JOIN public.worker_schedules AS schedule
          ON schedule.id = run.schedule_id
        WHERE run.schedule_id = 'g002-schedule';
      `),
    ).toBe("1|t");

    await assertSql(`
      DELETE FROM public.worker_task_attempts;
      DELETE FROM public.worker_tasks;
      DELETE FROM public.worker_runs;
      UPDATE public.worker_schedules
      SET enabled = true, next_due_at = clock_timestamp() - interval '1 second'
      WHERE id = 'g002-schedule';
    `);
    const disableFirst = psql(`
      BEGIN;
      SELECT (worker_private.set_schedule_enabled(
        'g002-schedule', false, NULL
      )).enabled;
      SELECT pg_sleep(0.5);
      COMMIT;
    `);
    await Bun.sleep(50);
    const enqueueSecond = enqueue();
    const [disableFirstResult, enqueueSecondResult] = await Promise.all([
      disableFirst,
      enqueueSecond,
    ]);
    expect(disableFirstResult.exitCode, disableFirstResult.stderr).toBe(0);
    expect(enqueueSecondResult.exitCode, enqueueSecondResult.stderr).toBe(0);
    expect(
      await assertSql(`
        SELECT count(*) FROM public.worker_runs
        WHERE schedule_id = 'g002-schedule';
      `),
    ).toBe("0");
  });

  runIntegration("serializes canonical write before authorization downgrade", async () => {
    await resetFixtureState();
    await assertSql(`
      SELECT worker_private.enqueue_run(
        'provider_ingestion', 'apec', 'g002:write-first', 'system',
        'write-first-task', 'provider.fetch_page', '{}'::jsonb
      );
      SELECT count(*) FROM worker_private.claim_tasks('write-first-worker', 1, 30);
    `);
    const job = canonicalJob("g002-write-first", "job_7022729131d5a949", "Write First");
    const writeFirst = psql(`
      BEGIN;
      SELECT worker_private.write_jobs_and_complete(
        task.id, task.lease_token, task.claim_generation, task.lease_owner,
        '${JSON.stringify([job])}'::jsonb
      )
      FROM public.worker_tasks AS task
      WHERE task.task_key = 'write-first-task';
      SELECT pg_sleep(0.5);
      COMMIT;
    `);
    await Bun.sleep(50);
    const downgradeSecond = psql(`
      SELECT (worker_private.set_provider_authorization(
        'apec', 'blocked', 'test-downgrade', clock_timestamp()
      )).authorization_status;
    `);
    const [writeResult, downgradeResult] = await Promise.all([writeFirst, downgradeSecond]);
    expect(writeResult.exitCode, writeResult.stderr).toBe(0);
    expect(downgradeResult.exitCode, downgradeResult.stderr).toBe(0);
    expect(
      await assertSql(`
        SELECT job.job_id, task.status, registry.authorization_status,
          registry.enabled
        FROM public.jobs AS job
        CROSS JOIN public.worker_tasks AS task
        CROSS JOIN public.provider_registry AS registry
        WHERE job.external_id = 'g002-write-first'
          AND task.task_key = 'write-first-task'
          AND registry.provider = 'apec';
      `),
    ).toBe("job_7022729131d5a949|succeeded|blocked|f");
  });

  runIntegration("locks down security-definer functions and direct tables", async () => {
    await resetFixtureState();

    expect(
      await assertSql(`
        SELECT count(*)
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'worker_private'
          AND procedure.prosecdef
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(coalesce(procedure.proconfig, ARRAY[]::text[])) AS setting
            WHERE setting LIKE 'search_path=%'
          );
      `),
    ).toBe("0");
    expect(
      await assertSql(`
        SELECT count(*)
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'worker_private'
          AND procedure.prosecdef;
      `),
    ).not.toBe("0");

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

    expect(
      await assertSql(`
        SET ROLE hirly_inventory_reader;
        SELECT contract_version FROM public.worker_capability_status;
      `),
    ).toBe("worker-foundation.v1");
    const readerRegistry = await psql(`
      SET ROLE hirly_inventory_reader;
      SELECT count(*) FROM public.provider_registry;
    `);
    expect(readerRegistry.exitCode).not.toBe(0);
    expect(readerRegistry.stderr).toContain("permission denied");

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

  runIntegration("rolls back only foundation objects and reapplies cleanly", async () => {
    await resetFixtureState();
    await applyFile(rollbackPath());
    expect(await assertSql(`SELECT to_regclass('public.jobs') IS NOT NULL;`)).toBe("t");
    expect(
      await assertSql(`
        SELECT count(*) FROM (
          VALUES
            (to_regclass('public.worker_runs')),
            (to_regclass('public.worker_tasks')),
            (to_regclass('public.worker_task_attempts')),
            (to_regclass('public.worker_schedules')),
            (to_regclass('public.provider_registry'))
        ) AS objects(object_name)
        WHERE object_name IS NOT NULL;
      `),
    ).toBe("0");
    await applyFile(migrationPath());
    expect(
      await assertSql(`
        SELECT count(*) FROM (
          VALUES
            (to_regclass('public.worker_runs')),
            (to_regclass('public.worker_tasks')),
            (to_regclass('public.worker_task_attempts')),
            (to_regclass('public.worker_schedules')),
            (to_regclass('public.provider_registry'))
        ) AS objects(object_name)
        WHERE object_name IS NOT NULL;
      `),
    ).toBe("5");
  });
});

test("G002 real-Postgres suite is opt-in outside CI service setup", () => {
  if (!databaseUrl) {
    expect(
      readFileSync(join(repoRoot, "backend", "db", "jobs_inventory_schema.sql"), "utf8"),
    ).toContain("CREATE TABLE IF NOT EXISTS jobs");
  } else {
    expect(databaseUrl).toMatch(/^postgres(?:ql)?:\/\//);
  }
});
