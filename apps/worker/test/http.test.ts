import { afterEach, describe, expect, test } from "bun:test";
import { createJsonLogger } from "@hirly/observability";
import { startHttpServer } from "../src/http/server";
import type { RuntimeConfig } from "../src/runtime/config";
import type { RuntimeStore } from "../src/runtime/types";

const token = "x".repeat(32);
const config: RuntimeConfig = {
  NODE_ENV: "test",
  JOBS_DATABASE_URL: "postgres://localhost/test",
  WORKER_CONCURRENCY: 1,
  WORKER_LEASE_SECONDS: 30,
  WORKER_HEARTBEAT_SECONDS: 5,
  WORKER_CONTROL_ENABLED: true,
  WORKER_CONTROL_TOKEN: token,
  PORT: 0,
  WORKER_POLL_MS: 10,
  WORKER_SCHEDULE_POLL_MS: 10,
  WORKER_SHUTDOWN_MS: 100,
  WORKER_INSTANCE_ID: "test",
  JOB_PROJECTION_ENABLED: false,
  PROJECTION_RECONCILIATION_ENABLED: false,
  JOB_PROJECTION_BATCH_SIZE: 10,
  JOB_PROJECTION_RECONCILIATION_BATCH_SIZE: 100,
};

const queue = {
  async enqueue() {
    return "00000000-0000-4000-8000-000000000001";
  },
  async ping() {
    return true;
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
  async enqueue() {
    return "00000000-0000-4000-8000-000000000002";
  },
  async assertProviderRunnable() {
    throw new Error("authorization_blocked");
  },
  async dueSchedules() {
    return [];
  },
  async enqueueDueSchedule() {
    return null;
  },
  async getRun() {
    return null;
  },
};

let server: Bun.Server<unknown> | undefined;
afterEach(() => server?.stop(true));

describe("worker HTTP plane", () => {
  test("reports live and ready state without caching", async () => {
    server = startHttpServer({
      config,
      queue,
      store,
      logger: createJsonLogger(() => {}),
      health: { ready: true },
    });
    const response = await fetch(`${server.url}health/ready`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("fails control routes closed and rejects blocked providers", async () => {
    server = startHttpServer({
      config,
      queue,
      store,
      logger: createJsonLogger(() => {}),
      health: { ready: true },
    });
    expect(
      (await fetch(`${server.url}control/enqueue`, { method: "POST" })).status,
    ).toBe(401);
    const response = await fetch(`${server.url}control/enqueue`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "provider_ingestion",
        provider: "wttj",
        idempotencyKey: "blocked",
        triggerSource: "http",
        tasks: [
          {
            taskKey: "wttj:first",
            taskType: "provider.fetch_page",
            payload: {},
          },
        ],
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "authorization_blocked" });
  });
});
