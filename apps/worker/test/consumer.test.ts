import { describe, expect, test } from "bun:test";
import type { ClaimedTask, Lease } from "@hirly/db";
import { createJsonLogger } from "@hirly/observability";
import { Consumer } from "../src/runtime/consumer";
import type { ConsumerRepository } from "../src/runtime/types";

const task: ClaimedTask = {
  taskId: "00000000-0000-4000-8000-000000000001",
  runId: "00000000-0000-4000-8000-000000000002",
  taskKey: "test",
  taskType: "inventory.maintenance",
  provider: null,
  payload: {},
  leaseToken: "00000000-0000-4000-8000-000000000003",
  claimGeneration: 1n,
  leaseOwner: "test-worker",
  attempts: 1,
  maxAttempts: 3,
  leaseUntil: new Date(Date.now() + 30_000),
};

class FakeRepository implements ConsumerRepository {
  claims = [[task], []] as ClaimedTask[][];
  finished: Array<{ outcome: string; options: unknown }> = [];

  async claim(): Promise<ClaimedTask[]> {
    return this.claims.shift() ?? [];
  }
  async heartbeat(): Promise<boolean> {
    return true;
  }
  async finish(
    _lease: Lease,
    outcome: "succeeded" | "retryable" | "failed" | "cancelled",
    options?: unknown,
  ): Promise<boolean> {
    this.finished.push({ outcome, options });
    return true;
  }
  async enqueue(): Promise<string> {
    return task.runId;
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}

describe("consumer lifecycle", () => {
  test("claims and completes through the common handler path", async () => {
    const repository = new FakeRepository();
    const consumer = new Consumer(
      repository,
      { "inventory.maintenance": async () => {} },
      createJsonLogger(() => {}),
      {
        concurrency: 1,
        leaseSeconds: 30,
        heartbeatSeconds: 5,
        pollMs: 5,
        instanceId: "test-worker",
        serviceVersion: "test",
        environment: "test",
      },
    );
    consumer.start();
    await Bun.sleep(20);
    await consumer.stop(100);
    expect(repository.finished).toEqual([
      { outcome: "succeeded", options: undefined },
    ]);
  });

  test("marks transient failures retryable", async () => {
    const repository = new FakeRepository();
    const consumer = new Consumer(
      repository,
      {
        "inventory.maintenance": async () => {
          throw new Error("temporary");
        },
      },
      createJsonLogger(() => {}),
      {
        concurrency: 1,
        leaseSeconds: 30,
        heartbeatSeconds: 5,
        pollMs: 5,
        instanceId: "test-worker",
        serviceVersion: "test",
        environment: "test",
      },
    );
    consumer.start();
    await Bun.sleep(20);
    await consumer.stop(100);
    expect(repository.finished[0]?.outcome).toBe("retryable");
  });
});
