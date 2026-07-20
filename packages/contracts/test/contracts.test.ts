import { describe, expect, test } from "bun:test";
import {
  careerSourceCandidateRegistrationSchema,
  CONTRACT_VERSION,
  enqueueRunSchema,
  healthSchema,
  providerRegistrySchema,
  sourceTrialManifestSchema,
  sourceTrialResultSchema,
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

  test("validates disabled ATS tenant registration metadata", () => {
    const candidate = {
      provider: "greenhouse",
      sourceKey: "greenhouse:hirly",
      tenantKey: "hirly",
      companyId: null,
      companyName: "Hirly",
      countryCodes: ["FR"],
      baseUrl: "https://boards.greenhouse.io/hirly",
      accessType: "tenant_feed" as const,
      syncFrequencySeconds: 3600,
      checkpoint: { version: "ats-discovery.v1" },
    };

    expect(careerSourceCandidateRegistrationSchema.parse(candidate)).toEqual(
      candidate,
    );
    for (const baseUrl of [
      "http://boards.greenhouse.io/hirly",
      "https://user:secret@boards.greenhouse.io/hirly",
      "https://boards.greenhouse.io/hirly?token=secret",
      "https://boards.greenhouse.io/hirly#jobs",
    ]) {
      expect(() =>
        careerSourceCandidateRegistrationSchema.parse({
          ...candidate,
          baseUrl,
        }),
      ).toThrow();
    }
  });

  test("validates bounded non-production source trial manifests and results", () => {
    const manifest = {
      schemaVersion: "hirly.source-trial-manifest.v1" as const,
      trialKey: "greenhouse:hirly:2026-07-20",
      sourceId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a90",
      provider: "greenhouse" as const,
      tenantKey: "hirly",
      environment: "staging" as const,
      countryCodes: ["FR"],
      policyEvidenceId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a91",
      requestedAt: "2026-07-20T12:00:00+00:00",
      expiresAt: "2026-07-21T12:00:00+00:00",
      budget: {
        maxPages: 25,
        maxCandidates: 2_500,
        maxBytes: 50_000_000,
      },
    };
    expect(sourceTrialManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      sourceTrialResultSchema.parse({
        schemaVersion: "hirly.source-trial-result.v1",
        runId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a92",
        trialKey: manifest.trialKey,
        status: "completed",
        startedAt: manifest.requestedAt,
        finishedAt: "2026-07-20T12:05:00+00:00",
        pagesFetched: 3,
        candidatesObserved: 120,
        bytesStored: 45_000,
        stopReason: null,
      }).status,
    ).toBe("completed");
    for (const invalidResult of [
      {
        status: "policy_expired",
        stopReason: "rate_limited",
      },
      {
        status: "failed",
        stopReason: "policy_expired",
      },
      {
        status: "budget_exhausted",
        stopReason: "retryable",
      },
      {
        status: "completed",
        stopReason: "unclassified_failure",
      },
    ]) {
      expect(() =>
        sourceTrialResultSchema.parse({
          schemaVersion: "hirly.source-trial-result.v1",
          runId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a92",
          trialKey: manifest.trialKey,
          startedAt: manifest.requestedAt,
          finishedAt: "2026-07-20T12:05:00+00:00",
          pagesFetched: 0,
          candidatesObserved: 0,
          bytesStored: 0,
          ...invalidResult,
        }),
      ).toThrow();
    }

    for (const invalid of [
      { ...manifest, environment: "production" },
      { ...manifest, countryCodes: ["FR", "FR"] },
      {
        ...manifest,
        budget: { ...manifest.budget, maxBytes: 1_073_741_825 },
      },
      {
        ...manifest,
        requestedAt: manifest.expiresAt,
      },
    ]) {
      expect(() => sourceTrialManifestSchema.parse(invalid)).toThrow();
    }
  });
});
