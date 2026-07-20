import { describe, expect, test } from "bun:test";
import {
  careerSourceCandidateRegistrationSchema,
  CONTRACT_VERSION,
  enqueueRunSchema,
  healthSchema,
  providerRegistrySchema,
} from "../src";

describe("shared contracts", () => {
  test("accepts an allowlisted typed run", () => {
    expect(
      enqueueRunSchema.parse({
        kind: "provider_ingestion",
        provider: "apec",
        idempotencyKey: "cli:apec:2026-07-20",
        triggerSource: "cli",
        tasks: [
          {
            taskKey: "page:1",
            taskType: "provider.fetch_page",
            payload: { cursor: null },
          },
        ],
      }).tasks[0]?.maxAttempts,
    ).toBe(5);
  });

  test("rejects unknown executable task types", () => {
    expect(() =>
      enqueueRunSchema.parse({
        kind: "provider_ingestion",
        provider: "apec",
        idempotencyKey: "bad",
        triggerSource: "http",
        tasks: [{ taskKey: "1", taskType: "shell.exec", payload: {} }],
      }),
    ).toThrow();
  });

  test("rejects enabling an unauthorized or Python-owned provider", () => {
    for (const invalid of [
      { authorizationStatus: "blocked", writerRuntime: "typescript" },
      { authorizationStatus: "authorized", writerRuntime: "python" },
    ] as const) {
      expect(() =>
        providerRegistrySchema.parse({
          provider: "indeed",
          accessMethod: "partner-api",
          authorizationEvidenceRef: null,
          authorizationReviewedAt: null,
          enabled: true,
          rateLimitConfig: { requestsPerMinute: 10, concurrency: 1 },
          ...invalid,
        }),
      ).toThrow();
    }
  });

  test("uses one versioned non-sensitive health contract", () => {
    expect(
      healthSchema.parse({ status: "ready", contractVersion: CONTRACT_VERSION }),
    ).toEqual({ status: "ready", contractVersion: CONTRACT_VERSION });
  });
});
