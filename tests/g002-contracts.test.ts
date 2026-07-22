import { describe, expect, test } from "bun:test";
import {
  canonicalJobSchema,
  enqueueRunSchema,
  providerRegistrySchema,
} from "../packages/contracts/src";
import { parseWorkerConfig } from "../packages/config/src";
import { eventSchema, serializeEvent } from "../packages/observability/src";

const databaseUrl = "postgresql://worker:secret@localhost:5432/inventory";

describe("G002 shared contract boundaries", () => {
  test("rejects malformed canonical identity and country values", () => {
    const validJob = {
      jobId: "job_0123456789abcdef",
      provider: "apec",
      externalId: "external-1",
      title: "Staff Engineer",
      normalizedTitle: "staff engineer",
      company: "Hirly",
      normalizedCompany: "hirly",
      location: "Paris",
      countryCode: "FR",
      selectedApplyUrl: "https://example.com/apply",
      validationStatus: "valid",
      validationReason: "direct ATS fixture",
      validationCheckedAt: "2026-07-20T00:00:00Z",
      applyabilityTier: "A",
      applyabilityScore: 1,
      applyFulfillmentStatus: "manual_ready",
      applyUrlProvider: "company",
      atsProvider: "greenhouse",
      requiresLogin: false,
      requiresAccountCreation: false,
      captchaDetected: false,
      manualFulfillmentReady: true,
      autoApplySupported: true,
      rejectionReason: null,
      fingerprint: "fingerprint-1",
      data: { source: "fixture" },
    };

    expect(canonicalJobSchema.parse(validJob)).toEqual(validJob);
    expect(() => canonicalJobSchema.parse({ ...validJob, jobId: "external-1" })).toThrow();
    expect(() => canonicalJobSchema.parse({ ...validJob, countryCode: "France" })).toThrow();
  });

  test("rejects invalid rate limits and unauthorized writer combinations", () => {
    const validProvider = {
      provider: "apec",
      accessMethod: "approved-feed",
      authorizationStatus: "authorized",
      authorizationEvidenceRef: "approval:2026-07-20",
      authorizationReviewedAt: "2026-07-20T00:00:00Z",
      enabled: true,
      writerRuntime: "typescript",
      rateLimitConfig: { requestsPerMinute: 60, concurrency: 2 },
    };

    expect(providerRegistrySchema.parse(validProvider)).toEqual(validProvider);
    expect(() =>
      providerRegistrySchema.parse({
        ...validProvider,
        rateLimitConfig: { requestsPerMinute: 0, concurrency: 2 },
      }),
    ).toThrow();
    expect(() =>
      providerRegistrySchema.parse({
        ...validProvider,
        authorizationStatus: "blocked",
      }),
    ).toThrow();
    expect(() =>
      providerRegistrySchema.parse({
        ...validProvider,
        writerRuntime: "python",
      }),
    ).toThrow();
  });

  test("rejects unknown task types and invalid schedule timestamps", () => {
    const validRun = {
      kind: "provider_ingestion",
      provider: "apec",
      idempotencyKey: "schedule:apec:2026-07-20T00:00:00Z",
      triggerSource: "schedule",
      scheduleId: "apec-hourly",
      scheduledFor: "2026-07-20T00:00:00Z",
      tasks: [
        {
          taskKey: "page:1",
          taskType: "provider.fetch_page",
          payload: { cursor: null },
          maxAttempts: 5,
        },
      ],
    };

    expect(enqueueRunSchema.parse(validRun).tasks).toHaveLength(1);
    expect(() =>
      enqueueRunSchema.parse({
        ...validRun,
        tasks: [{ ...validRun.tasks[0], taskType: "shell.exec" }],
      }),
    ).toThrow();
    expect(() =>
      enqueueRunSchema.parse({
        ...validRun,
        scheduledFor: "tomorrow",
      }),
    ).toThrow();
  });

  test("fails startup for unsafe concurrency, lease, and control settings", () => {
    expect(() =>
      parseWorkerConfig({
        JOBS_DATABASE_URL: databaseUrl,
        WORKER_CONCURRENCY: "0",
      }),
    ).toThrow();
    expect(() =>
      parseWorkerConfig({
        JOBS_DATABASE_URL: databaseUrl,
        WORKER_LEASE_SECONDS: "4",
      }),
    ).toThrow();
    expect(() =>
      parseWorkerConfig({
        JOBS_DATABASE_URL: databaseUrl,
        WORKER_CONTROL_ENABLED: "true",
        WORKER_CONTROL_TOKEN: "short",
      }),
    ).toThrow();
  });
});

describe("G002 observability contract", () => {
  test("accepts required timing and inventory counters", () => {
    const event = {
      service: "worker",
      version: "1",
      environment: "test",
      event: "provider.batch.completed",
      severity: "info",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      taskType: "provider.fetch_page",
      provider: "apec",
      triggerSource: "schedule",
      attempt: 1,
      maxAttempts: 5,
      durationsMs: {
        queueWait: 10,
        fetch: 20,
        normalization: 5,
        validation: 4,
        database: 7,
        total: 46,
      },
      counts: {
        fetched: 10,
        accepted: 8,
        rejected: 2,
        deduplicated: 1,
        upserted: 7,
      },
      outcome: "succeeded",
      reasonCode: "completed",
    };

    expect(eventSchema.parse(event)).toEqual(event);
  });

  test("redacts secret-bearing fields, credentials, and PII recursively", () => {
    const serialized = serializeEvent({
      service: "worker",
      version: "1",
      environment: "test",
      event: "provider.failed",
      severity: "error",
      details: {
        token: "top-secret-token",
        databaseUrl: databaseUrl,
        authorizationEvidenceBody: "private-approval",
        nested: {
          email: "person@example.com",
          message: "Bearer abc.def.ghi",
        },
      },
    });

    for (const secret of [
      "top-secret-token",
      "worker:secret",
      "private-approval",
      "person@example.com",
      "abc.def.ghi",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
