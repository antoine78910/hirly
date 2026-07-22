import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createJsonLogger } from "../packages/observability/src/index";
import type { ClaimedTask, Lease } from "../packages/db/src/index";
import { Consumer } from "../apps/worker/src/runtime/consumer";
import { nextCronOccurrence, runSchedulerTick } from "../apps/worker/src/runtime/scheduler";
import { createHttpHandler, startHttpServer } from "../apps/worker/src/http/server";
import type { RuntimeConfig } from "../apps/worker/src/runtime/config";
import type { ConsumerRepository, RuntimeStore } from "../apps/worker/src/runtime/types";
import { parseCliArgs } from "../apps/worker/src/cli";
import { createWorkerRuntime } from "../apps/worker/src/runtime/lifecycle";
import { createShutdownHandler } from "../apps/worker/src/main";

const repoRoot = join(import.meta.dir, "..");

type PackageJson = {
  scripts?: Record<string, string>;
  workspaces?: string[];
};

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(check: () => boolean, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await Bun.sleep(2);
  }
}

function claimedTask(overrides: Partial<ClaimedTask> = {}): ClaimedTask {
  return {
    taskId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    taskKey: "inventory-maintenance",
    taskType: "inventory.maintenance",
    provider: null,
    payload: {},
    leaseToken: "00000000-0000-4000-8000-000000000003",
    claimGeneration: 1n,
    leaseOwner: "g003-test-worker",
    attempts: 1,
    maxAttempts: 3,
    leaseUntil: new Date(Date.now() + 30_000),
    ...overrides,
  };
}

class AdversarialRepository implements ConsumerRepository {
  readonly finishCalls: Array<{
    outcome: "succeeded" | "retryable" | "failed" | "cancelled";
    options:
      | {
          errorCode?: string;
          errorMessage?: string;
          retryAt?: Date;
        }
      | undefined;
  }> = [];
  claimCalls = 0;
  heartbeatCalls = 0;
  claims: ClaimedTask[][] = [];
  finishResult = true;

  async claim(): Promise<ClaimedTask[]> {
    this.claimCalls += 1;
    return this.claims.shift() ?? [];
  }

  async heartbeat(): Promise<boolean> {
    this.heartbeatCalls += 1;
    return true;
  }

  async finish(
    _lease: Lease,
    outcome: "succeeded" | "retryable" | "failed" | "cancelled",
    options?: {
      errorCode?: string;
      errorMessage?: string;
      retryAt?: Date;
    },
  ): Promise<boolean> {
    this.finishCalls.push({ outcome, options });
    return this.finishResult;
  }

  async enqueue(): Promise<string> {
    return "00000000-0000-4000-8000-000000000002";
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

const consumerOptions = {
  concurrency: 1,
  leaseSeconds: 30,
  heartbeatSeconds: 0.005,
  pollMs: 2,
  instanceId: "g003-test-worker",
  serviceVersion: "test",
  environment: "test",
};

describe("G003 worker runtime delivery contract", () => {
  test("is a separately deployable Bun workspace with Railway health semantics", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const workerPackage = readJson<PackageJson>("apps/worker/package.json");
    const dockerfile = read("apps/worker/Dockerfile");
    const railway = read("apps/worker/railway.toml");

    expect(rootPackage.workspaces).toContain("apps/*");
    expect(workerPackage.scripts?.typecheck).toBeTruthy();
    expect(workerPackage.scripts?.test).toBeTruthy();
    expect(workerPackage.scripts?.build).toBeTruthy();
    expect(workerPackage.scripts?.["docker:build"]).toBeTruthy();
    expect(dockerfile).toMatch(/\b(?:bun|oven\/bun)\b/i);
    expect(dockerfile).not.toMatch(/\b(?:python|uvicorn|fastapi)\b/i);
    expect(railway).toContain("/health/ready");
    expect(railway).not.toContain("/api/health");
  });

  test("root and CI commands discover the adversarial matrix", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const workflow = read(".github/workflows/typescript-foundation.yml");

    expect(rootPackage.scripts?.test).toContain("bun test ./tests");
    expect(rootPackage.scripts?.["test:g003"]).toContain("g003-worker-runtime.test.ts");
    expect(rootPackage.scripts?.["test:g003"]).toContain("apps/worker");
    expect(workflow).toContain("bun run test:g003");
  });

  test("keeps the runtime surface isolated from existing production routes", () => {
    expect(existsSync(join(repoRoot, "apps", "worker", "src", "main.ts"))).toBe(true);
    const rootVercel = read("vercel.json");
    expect(rootVercel).not.toContain("apps/worker");
    expect(rootVercel).not.toContain("/health/ready");
  });
});

describe("G003 fencing, retry, restart, and shutdown behavior", () => {
  test("treats a stale successful completion as lease_lost, never canonical success", async () => {
    const repository = new AdversarialRepository();
    repository.claims.push([claimedTask()]);
    repository.finishResult = false;
    const events: Array<Record<string, unknown>> = [];
    const consumer = new Consumer(
      repository,
      { "inventory.maintenance": async () => {} },
      createJsonLogger((event) => events.push(JSON.parse(event))),
      consumerOptions,
    );

    consumer.start();
    await waitFor(() => repository.finishCalls.length >= 2);
    await consumer.stop(100);

    expect(repository.finishCalls.map(({ outcome }) => outcome)).toEqual(["succeeded", "failed"]);
    expect(repository.finishCalls[1]?.options?.errorCode).toBe("lease_lost");
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "worker.task_terminal",
        outcome: "failed",
        reasonCode: "lease_lost",
      }),
    );
  });

  test("stops claiming before drain while heartbeats protect active work", async () => {
    const repository = new AdversarialRepository();
    repository.claims.push([claimedTask()]);
    const gate = deferred();
    const consumer = new Consumer(
      repository,
      { "inventory.maintenance": async () => gate.promise },
      createJsonLogger(() => {}),
      consumerOptions,
    );

    consumer.start();
    await waitFor(() => consumer.activeCount === 1);
    const stopping = consumer.stop(200);
    const claimsAtDrainStart = repository.claimCalls;
    await waitFor(() => repository.heartbeatCalls > 0);

    expect(repository.claimCalls).toBe(claimsAtDrainStart);
    expect(consumer.activeCount).toBe(1);

    gate.resolve();
    await stopping;
    expect(repository.finishCalls[0]?.outcome).toBe("succeeded");
  });
});

describe("G003 persisted scheduler identity", () => {
  test("derives the next occurrence from persisted state after restart", () => {
    const persisted = new Date("2026-07-20T10:07:00.000Z");
    expect(nextCronOccurrence("*/15 * * * *", "UTC", persisted).toISOString()).toBe(
      "2026-07-20T10:15:00.000Z",
    );
  });

  test("gives both DST fallback occurrences distinct UTC identities", () => {
    const first = nextCronOccurrence(
      "30 2 * * *",
      "Europe/Paris",
      new Date("2026-10-25T00:29:00.000Z"),
    );
    const second = nextCronOccurrence("30 2 * * *", "Europe/Paris", first);

    expect(first.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(second.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  test("bounds catch-up from persisted next_due_at", async () => {
    const successors: string[] = [];
    const store = {
      async dueSchedules() {
        return [
          {
            id: "schedule-1",
            cronExpression: "* * * * *",
            timezone: "UTC",
            nextDueAt: new Date("2026-07-20T10:00:00.000Z"),
            maxCatchUp: 2,
            databaseNow: new Date("2026-07-20T10:05:00.000Z"),
          },
        ];
      },
      async enqueueDueSchedule(_id: string, successor: Date) {
        successors.push(successor.toISOString());
        return `run-${successors.length}`;
      },
    } as RuntimeStore;

    expect(await runSchedulerTick(store)).toBe(2);
    expect(successors).toEqual(["2026-07-20T10:01:00.000Z", "2026-07-20T10:02:00.000Z"]);
  });

  test("stops a catch-up batch when the locked schedule is disabled or advanced", async () => {
    let attempts = 0;
    const store = {
      async dueSchedules() {
        return [
          {
            id: "schedule-disabled-during-race",
            cronExpression: "* * * * *",
            timezone: "UTC",
            nextDueAt: new Date("2026-07-20T10:00:00.000Z"),
            maxCatchUp: 10,
            databaseNow: new Date("2026-07-20T10:30:00.000Z"),
          },
        ];
      },
      async enqueueDueSchedule() {
        attempts += 1;
        return null;
      },
    } as RuntimeStore;

    expect(await runSchedulerTick(store)).toBe(0);
    expect(attempts).toBe(1);
  });
});

describe("G003 HTTP health and control-plane hardening", () => {
  const token = "g003-control-token".repeat(2);
  const config: RuntimeConfig = {
    NODE_ENV: "test",
    JOBS_DATABASE_URL: "postgres://127.0.0.1/disposable",
    WORKER_CONCURRENCY: 1,
    WORKER_LEASE_SECONDS: 30,
    WORKER_HEARTBEAT_SECONDS: 5,
    WORKER_CONTROL_ENABLED: true,
    WORKER_CONTROL_TOKEN: token,
    PORT: 0,
    WORKER_POLL_MS: 10,
    WORKER_SCHEDULE_POLL_MS: 10,
    WORKER_SHUTDOWN_MS: 100,
    WORKER_INSTANCE_ID: "g003-test",
  };

  function fixtures() {
    let ping = true;
    let enqueueCalls = 0;
    const queue = {
      async enqueue() {
        enqueueCalls += 1;
        return "00000000-0000-4000-8000-000000000002";
      },
      async ping() {
        return ping;
      },
      async claim() {
        return [];
      },
      async heartbeat() {
        return true;
      },
      async finish() {
        return true;
      },
      async close() {},
    };
    const store: RuntimeStore = {
      async assertProviderRunnable() {},
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return {
          id: "00000000-0000-4000-8000-000000000002",
          kind: "inventory_maintenance",
          provider: null,
          triggerSource: "http",
          status: "running",
          requestedAt: "2026-07-20T00:00:00.000Z",
          startedAt: "2026-07-20T00:00:01.000Z",
          finishedAt: null,
          summary: {},
          errorCode: null,
        };
      },
    };
    return {
      queue,
      store,
      setPing(value: boolean) {
        ping = value;
      },
      get enqueueCalls() {
        return enqueueCalls;
      },
    };
  }

  test("keeps liveness public while readiness tracks initialization and database state", async () => {
    const fixture = fixtures();
    const health = { ready: false };
    const server = startHttpServer({
      config,
      queue: fixture.queue,
      store: fixture.store,
      logger: createJsonLogger(() => {}),
      health,
    });
    try {
      expect((await fetch(`${server.url}health/live`)).status).toBe(200);
      expect((await fetch(`${server.url}health/ready`)).status).toBe(503);
      health.ready = true;
      expect((await fetch(`${server.url}health/ready`)).status).toBe(200);
      fixture.setPing(false);
      expect((await fetch(`${server.url}health/ready`)).status).toBe(503);
    } finally {
      server.stop(true);
    }
  });

  test("fails closed, bounds bodies, and rejects executable payloads", async () => {
    const fixture = fixtures();
    const server = startHttpServer({
      config,
      queue: fixture.queue,
      store: fixture.store,
      logger: createJsonLogger(() => {}),
      health: { ready: true },
    });
    try {
      const endpoint = `${server.url}control/enqueue`;
      expect((await fetch(endpoint, { method: "POST" })).status).toBe(401);
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers: { authorization: "Bearer definitely-wrong" },
          })
        ).status,
      ).toBe(403);

      const malicious = JSON.stringify({
        kind: "inventory_maintenance",
        provider: null,
        idempotencyKey: "malicious",
        triggerSource: "http",
        tasks: [
          {
            taskKey: "inventory-maintenance",
            taskType: "inventory.maintenance",
            payload: { command: "rm -rf /" },
          },
        ],
      });
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: malicious,
          })
        ).status,
      ).toBe(400);

      const oversized = JSON.stringify({
        kind: "inventory_maintenance",
        provider: null,
        idempotencyKey: "x".repeat(70_000),
        triggerSource: "http",
        tasks: [
          {
            taskKey: "inventory-maintenance",
            taskType: "inventory.maintenance",
            payload: {},
          },
        ],
      });
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: oversized,
          })
        ).status,
      ).toBe(413);
      expect(fixture.enqueueCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("caps chunked bodies even when Content-Length is absent", async () => {
    const fixture = fixtures();
    const handler = createHttpHandler({
      config,
      queue: fixture.queue,
      store: fixture.store,
      logger: createJsonLogger(() => {}),
      health: { ready: true },
    });
    const encoded = new TextEncoder().encode(
      JSON.stringify({
        kind: "inventory_maintenance",
        provider: null,
        idempotencyKey: "x".repeat(70_000),
        triggerSource: "http",
        tasks: [
          {
            taskKey: "inventory-maintenance",
            taskType: "inventory.maintenance",
            payload: {},
          },
        ],
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < encoded.length; offset += 4_096) {
          controller.enqueue(encoded.slice(offset, offset + 4_096));
        }
        controller.close();
      },
    });
    const response = await handler(
      new Request("http://worker.test/control/enqueue", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
      }),
    );

    expect(response.status).toBe(413);
    expect(fixture.enqueueCalls).toBe(0);
  });

  test("bounds readiness checks and redacts unexpected dependency failures", async () => {
    const fixture = fixtures();
    const neverReadyQueue = {
      ...fixture.queue,
      async ping(): Promise<boolean> {
        return new Promise<boolean>(() => {});
      },
    };
    const dependencyFailureStore = {
      ...fixture.store,
      async getRun() {
        throw new Error("postgresql://worker:super-secret@db.internal/jobs failed");
      },
    };
    const handler = createHttpHandler({
      config,
      queue: neverReadyQueue,
      store: dependencyFailureStore,
      logger: createJsonLogger(() => {}),
      health: { ready: true },
    });

    const readiness = await Promise.race([
      handler(new Request("http://worker.test/health/ready")),
      Bun.sleep(1_500).then(() => "timed_out" as const),
    ]);
    expect(readiness).not.toBe("timed_out");
    expect((readiness as Response).status).toBe(503);

    const failure = await handler(
      new Request("http://worker.test/control/runs/00000000-0000-4000-8000-000000000002", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const failureBody = JSON.stringify(await failure.json());
    expect(failureBody).not.toContain("super-secret");
    expect(failureBody).not.toContain("db.internal");
    expect(failureBody).not.toContain("postgresql://");
  });

  test("returns only the redacted run view", async () => {
    const fixture = fixtures();
    const server = startHttpServer({
      config,
      queue: fixture.queue,
      store: fixture.store,
      logger: createJsonLogger(() => {}),
      health: { ready: true },
    });
    try {
      const response = await fetch(
        `${server.url}control/runs/00000000-0000-4000-8000-000000000002`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const body = JSON.stringify(await response.json());
      expect(response.status).toBe(200);
      expect(body).not.toContain("payload");
      expect(body).not.toContain("leaseToken");
      expect(body).not.toContain("authorization");
    } finally {
      server.stop(true);
    }
  });
});

describe("G003 CLI and graceful lifecycle test seams", () => {
  test("CLI parsing is import-safe, typed, and rejects malformed commands", () => {
    expect(parseCliArgs(["enqueue-maintenance", "manual-1"])).toEqual({
      type: "enqueue-maintenance",
      idempotencyKey: "manual-1",
    });
    expect(parseCliArgs(["enqueue-provider", "apec", "manual-2"])).toEqual({
      type: "enqueue-provider",
      provider: "apec",
      idempotencyKey: "manual-2",
    });
    expect(() => parseCliArgs(["enqueue-provider", "unknown", "manual-3"])).toThrow();
    expect(() => parseCliArgs(["enqueue-maintenance", "manual-4", "unexpected"])).toThrow();
  });

  test("readiness flips before drain, shutdown is idempotent, and database closes last", async () => {
    const events: string[] = [];
    let ready = false;
    const health = {
      get ready() {
        return ready;
      },
      set ready(value: boolean) {
        ready = value;
        events.push(`ready:${value}`);
      },
    };
    const runtime = createWorkerRuntime({
      health,
      consumer: {
        start() {
          events.push("consumer:start");
        },
        stopClaiming() {
          events.push("consumer:stop-claiming");
        },
        async stop(timeoutMs) {
          events.push(`consumer:stop:${timeoutMs}`);
        },
      },
      scheduler: {
        start() {
          events.push("scheduler:start");
        },
        async stop() {
          events.push("scheduler:stop");
        },
      },
      server: {
        async stop(force) {
          events.push(`server:stop:${force}`);
        },
      },
      repository: {
        async close() {
          events.push("repository:close");
        },
      },
      shutdownMs: 250,
    });

    runtime.start();
    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;
    expect(events).toEqual([
      "consumer:start",
      "scheduler:start",
      "ready:true",
      "ready:false",
      "consumer:stop-claiming",
      "server:stop:false",
      "scheduler:stop",
      "consumer:stop:250",
      "repository:close",
    ]);
  });

  test("main handles termination only after graceful stop and invalid CLI exits nonzero", async () => {
    const mainSource = read("apps/worker/src/main.ts");
    expect(mainSource).toContain('process.on("SIGTERM"');
    expect(mainSource).toContain('process.on("SIGINT"');

    const successfulExits: number[] = [];
    let stopCalls = 0;
    const successfulShutdown = createShutdownHandler({
      application: {
        config: { NODE_ENV: "test" },
        async stop() {
          stopCalls += 1;
        },
      },
      write() {},
      exit(code) {
        successfulExits.push(code);
      },
    });
    const firstSignal = successfulShutdown("SIGTERM");
    const repeatedSignal = successfulShutdown("SIGINT");
    expect(repeatedSignal).toBe(firstSignal);
    await firstSignal;
    expect(stopCalls).toBe(1);
    expect(successfulExits).toEqual([0]);

    const failureLines: string[] = [];
    const failureExits: number[] = [];
    await createShutdownHandler({
      application: {
        config: { NODE_ENV: "test" },
        async stop() {
          throw new Error("postgresql://worker:secret@db.internal/jobs");
        },
      },
      write(line) {
        failureLines.push(line);
      },
      exit(code) {
        failureExits.push(code);
      },
    })("SIGTERM");
    expect(failureExits).toEqual([1]);
    expect(failureLines.join("\n")).toContain("worker.shutdown_failed");
    expect(failureLines.join("\n")).not.toContain("secret");
    expect(failureLines.join("\n")).not.toContain("db.internal");

    const child = Bun.spawn(
      [process.execPath, join(repoRoot, "apps", "worker", "src", "cli.ts"), "not-a-command"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          JOBS_DATABASE_URL: "postgresql://127.0.0.1:1/disposable",
          WORKER_CONTROL_ENABLED: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("usage:");
  });
});
