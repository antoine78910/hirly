import { describe, expect, test } from "bun:test";
import { createWorkerRuntime } from "../src/runtime/lifecycle";

describe("worker lifecycle", () => {
  test("flips readiness and stops triggers before drain, then closes DB", async () => {
    const calls: string[] = [];
    const health = { ready: false };
    const runtime = createWorkerRuntime({
      health,
      consumer: {
        start: () => calls.push("consumer:start"),
        stop: async () => {
          calls.push(`consumer:stop:ready=${health.ready}`);
        },
      },
      scheduler: {
        start: () => calls.push("scheduler:start"),
        stop: async () => {
          calls.push(`scheduler:stop:ready=${health.ready}`);
        },
      },
      server: {
        stop: () => calls.push(`server:stop:ready=${health.ready}`),
      },
      repository: {
        close: async () => {
          calls.push("repository:close");
        },
      },
      shutdownMs: 100,
    });
    runtime.start();
    expect(health.ready).toBe(true);
    await Promise.all([runtime.stop(), runtime.stop()]);
    expect(calls).toEqual([
      "consumer:start",
      "scheduler:start",
      "server:stop:ready=false",
      "scheduler:stop:ready=false",
      "consumer:stop:ready=false",
      "repository:close",
    ]);
  });
});
