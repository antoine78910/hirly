import { describe, expect, test } from "bun:test";
import type { JobSearchDocumentPersistenceRow } from "@hirly/contracts";
import type { JobProjectionLease } from "@hirly/db";
import type {
  JobProjectionResult,
  JobProjectionSource,
} from "@hirly/matching";
import {
  JobProjectionConsumer,
  type JobProjectionConsumerOptions,
  type JobProjectionStore,
} from "../src/runtime/job-projection-consumer";

const lease: JobProjectionLease = {
  taskId: "10000000-0000-4000-8000-000000000001",
  taskKind: "job.document.project",
  entityId: "20000000-0000-4000-8000-000000000002",
  entityVersion: 9n,
  idempotencyKey: "job:group:9",
  leaseOwner: "worker-test",
  leaseToken: "30000000-0000-4000-8000-000000000003",
  claimGeneration: 1n,
  leaseUntil: new Date("2026-07-21T09:00:00.000Z"),
  attempts: 1,
  maxAttempts: 8,
};

const options = (
  overrides: Partial<JobProjectionConsumerOptions> = {},
): JobProjectionConsumerOptions => ({
  enabled: true,
  reconciliationEnabled: false,
  instanceId: "worker-test",
  concurrency: 1,
  batchSize: 1,
  leaseSeconds: 60,
  heartbeatSeconds: 30,
  pollMs: 1,
  reconciliationBatchSize: 10,
  ...overrides,
});

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await Bun.sleep(2);
    }
  }
  assertion();
}

function store(overrides: Partial<JobProjectionStore> = {}): JobProjectionStore {
  return {
    claim: async () => [],
    heartbeat: async () => true,
    loadSource: async () => null,
    completeUpsert: async () => true,
    completeRemove: async () => true,
    finish: async () => true,
    enqueueReconciliation: async () => 0,
    ...overrides,
  };
}

describe("job projection consumer", () => {
  test("does not claim while the application rollout flag is disabled", async () => {
    let claims = 0;
    const consumer = new JobProjectionConsumer(
      store({ claim: async () => { claims += 1; return []; } }),
      options({ enabled: false }),
    );
    consumer.start();
    await Bun.sleep(5);
    await consumer.stop(20);
    expect(claims).toBe(0);
  });

  test("dispatches a projected document through the fenced completion", async () => {
    let claimed = false;
    const completed: Array<{ lease: JobProjectionLease; digest: string }> = [];
    const source = { authoritativeVersion: "9" } as JobProjectionSource;
    const row = { job_version: "9" } as JobSearchDocumentPersistenceRow;
    const result: JobProjectionResult = {
      action: "upsert",
      canonicalGroupId: lease.entityId,
      preferredJobId: "job_0123456789abcdef",
      authoritativeVersion: "9",
      sourceContentHash: "a".repeat(64),
      row,
    };
    const consumer = new JobProjectionConsumer(
      store({
        claim: async () => claimed ? [] : ((claimed = true), [lease]),
        loadSource: async () => source,
        completeUpsert: async (task, _row, digest) => {
          completed.push({ lease: task, digest });
          return true;
        },
      }),
      options(),
      async () => result,
    );
    consumer.start();
    await eventually(() => expect(completed).toHaveLength(1));
    await consumer.stop(50);
    expect(completed[0]).toEqual({ lease, digest: "a".repeat(64) });
  });

  test("uses the leased entity version for a missing canonical source", async () => {
    let claimed = false;
    const removals: Array<{ groupId: string; version: string }> = [];
    const consumer = new JobProjectionConsumer(
      store({
        claim: async () => claimed ? [] : ((claimed = true), [lease]),
        loadSource: async () => null,
        completeRemove: async (_task, groupId, version) => {
          removals.push({ groupId, version });
          return true;
        },
      }),
      options(),
    );
    consumer.start();
    await eventually(() => expect(removals).toHaveLength(1));
    await consumer.stop(50);
    expect(removals).toEqual([{ groupId: lease.entityId, version: "9" }]);
  });
});
