import { describe, expect, test } from "bun:test";
import type {
  JobProjectionLease,
  JobProjectionSourceRecord,
} from "@hirly/db";
import type { JobSearchDocumentPersistenceRow } from "@hirly/contracts";
import {
  JobProjectionConsumer,
  type JobProjectionStore,
} from "../src/runtime/job-projection-consumer";

const lease: JobProjectionLease = {
  taskId: "11111111-1111-4111-8111-111111111111",
  taskKind: "job.document.project",
  entityId: "22222222-2222-4222-8222-222222222222",
  entityVersion: 7n,
  idempotencyKey: "job:7",
  leaseOwner: "projection-1",
  leaseToken: "33333333-3333-4333-8333-333333333333",
  claimGeneration: 1n,
  sourceDigest: "b".repeat(64),
  leaseUntil: new Date(Date.now() + 30_000),
  attempts: 1,
  maxAttempts: 8,
};

const source: JobProjectionSourceRecord = {
  authoritativeVersion: "7",
  canonicalGroupId: lease.entityId,
  preferredJobId: "job_0123456789abcdef",
  groupStatus: "active",
  title: "Software Engineer",
  normalizedTitle: "software engineer",
  company: "Hirly",
  location: "Paris",
  countryCode: "FR",
  remote: null,
  latitude: null,
  longitude: null,
  publishedAt: "2026-07-20T00:00:00.000Z",
  importedAt: "2026-07-20T00:00:00.000Z",
  firstSeenAt: "2026-07-20T00:00:00.000Z",
  lastSeenAt: "2026-07-21T00:00:00.000Z",
  expiresAt: null,
  lifecycleState: "active",
  validationStatus: "valid",
  applyabilityTier: "B",
  applyFulfillmentStatus: "manual_ready",
  autoApplySupported: false,
  manualFulfillmentReady: true,
  sourceEligible: true,
  policyEligible: true,
  data: {},
};

const document = {
  schema_version: "hirly.matching.v1",
  canonical_group_id: lease.entityId,
  preferred_job_id: source.preferredJobId,
  job_version: "7",
  lifecycle_status: "active",
  normalized_title: "software-engineer",
  role_family_codes: [],
  sector_ids: [],
  industry_ids: [],
  rome_codes: [],
  skill_codes: [],
  seniority_min: null,
  seniority_max: null,
  contract_families: [],
  work_modes: [],
  country_codes: ["FR"],
  latitude: null,
  longitude: null,
  location_confidence: 0.6,
  location_unknown: false,
  salary_min: null,
  salary_max: null,
  currency: null,
  posted_at: source.publishedAt!,
  last_seen_at: source.lastSeenAt!,
  expires_at: null,
  validation_status: "valid",
  applyability_tier: "B",
  fulfillment_route: "manual",
  source_eligible: true,
  policy_eligible: true,
  feature_schema_version: "matching-job-features.v1",
  search_text: "software engineer",
  source_updated_at: "2026-07-21T00:00:00.000Z",
} satisfies JobSearchDocumentPersistenceRow;

function options(enabled: boolean) {
  return {
    enabled,
    reconciliationEnabled: false,
    instanceId: "projection-1",
    concurrency: 1,
    batchSize: 1,
    leaseSeconds: 30,
    heartbeatSeconds: 5,
    pollMs: 5,
    reconciliationBatchSize: 10,
  };
}

describe("job projection consumer", () => {
  test("does not claim when application rollout is disabled", async () => {
    let claims = 0;
    const store = {
      claim: async () => {
        claims += 1;
        return [];
      },
    } as unknown as JobProjectionStore;
    const consumer = new JobProjectionConsumer(store, options(false));
    consumer.start();
    await Bun.sleep(15);
    await consumer.stop(50);
    expect(claims).toBe(0);
  });

  test("projects and atomically completes a claimed document", async () => {
    const completed: unknown[][] = [];
    let claimed = false;
    const store: JobProjectionStore = {
      claim: async () => (claimed ? [] : ((claimed = true), [lease])),
      heartbeat: async () => true,
      loadSource: async () => source,
      completeUpsert: async (...args) => {
        completed.push(args);
        return true;
      },
      completeRemove: async () => true,
      finish: async () => true,
      enqueueReconciliation: async () => 0,
    };
    const consumer = new JobProjectionConsumer(
      store,
      options(true),
      async () => ({
        action: "upsert",
        canonicalGroupId: lease.entityId,
        preferredJobId: source.preferredJobId,
        authoritativeVersion: "7",
        sourceContentHash: "a".repeat(64),
        row: document,
      }),
      () => new Date("2026-07-21T00:00:00Z"),
    );
    consumer.start();
    await Bun.sleep(20);
    await consumer.stop(100);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.[0]).toBe(lease);
    expect(completed[0]?.[1]).toEqual(document);
  });

  test("persists only a sanitized failure class", async () => {
    let claimed = false;
    const finished: Array<Record<string, unknown> | undefined> = [];
    const store: JobProjectionStore = {
      claim: async () => (claimed ? [] : ((claimed = true), [lease])),
      heartbeat: async () => true,
      loadSource: async () => source,
      completeUpsert: async () => true,
      completeRemove: async () => true,
      finish: async (_task, _outcome, options) => {
        finished.push(options);
        return true;
      },
      enqueueReconciliation: async () => 0,
    };
    const consumer = new JobProjectionConsumer(
      store,
      options(true),
      async () => {
        throw new Error("postgres://user:secret@example.test/private-row");
      },
    );
    consumer.start();
    await Bun.sleep(20);
    await consumer.stop(100);
    expect(finished[0]).toMatchObject({
      errorCode: "projection_failed",
      errorMessage: undefined,
    });
    expect(JSON.stringify(finished)).not.toContain("secret");
  });

  test("returns at the shutdown deadline when an operation ignores abort", async () => {
    let claimed = false;
    const store: JobProjectionStore = {
      claim: async () => (claimed ? [] : ((claimed = true), [lease])),
      heartbeat: async () => true,
      loadSource: async () => source,
      completeUpsert: async () => new Promise<boolean>(() => {}),
      completeRemove: async () => true,
      finish: async () => true,
      enqueueReconciliation: async () => 0,
    };
    const consumer = new JobProjectionConsumer(
      store,
      options(true),
      async () => ({
        action: "upsert",
        canonicalGroupId: lease.entityId,
        preferredJobId: source.preferredJobId,
        authoritativeVersion: "7",
        sourceContentHash: "a".repeat(64),
        row: document,
      }),
    );
    consumer.start();
    await Bun.sleep(15);
    const started = performance.now();
    await consumer.stop(20);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
