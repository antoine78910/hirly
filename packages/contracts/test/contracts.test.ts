import { describe, expect, test } from "bun:test";
import {
  careerSourceCandidateRegistrationSchema,
  CONTRACT_VERSION,
  enqueueRunSchema,
  healthSchema,
  providerRegistrySchema,
  sourcePageCommitSchema,
  sourceTrialManifestSchema,
  sourceTrialResultSchema,
  sproutSourceRuntimeSchema,
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

  test("validates Sprout source commits and additive canonical fields", () => {
    const canonical = {
      jobId: "job_0123456789abcdef",
      provider: "sprout" as const,
      externalId: "123",
      title: "Software Engineer",
      normalizedTitle: "software engineer",
      company: "Example SAS",
      normalizedCompany: "example",
      location: "Paris, Ile-de-France, France",
      city: "Paris",
      region: "Ile-de-France",
      countryCode: "FR",
      remote: true,
      salaryMin: 50_000,
      salaryMax: 70_000,
      currency: "EUR",
      postedAt: "2026-07-20T12:00:00+00:00",
      importedAt: "2026-07-20T13:00:00+00:00",
      lastSeenAt: "2026-07-20T13:00:00+00:00",
      selectedApplyUrl: "https://example.com/jobs/123",
      validationStatus: "valid" as const,
      validationReason: "apply URL is reachable",
      validationCheckedAt: "2026-07-20T13:00:00+00:00",
      applyabilityTier: "B" as const,
      applyabilityScore: 0.8,
      applyFulfillmentStatus: "manual_ready" as const,
      applyUrlProvider: "example",
      atsProvider: "unknown",
      requiresLogin: false,
      requiresAccountCreation: false,
      captchaDetected: false,
      manualFulfillmentReady: true,
      autoApplySupported: false,
      rejectionReason: null,
      fingerprint: "fixture-fingerprint",
      data: { source: "sprout" },
    };
    expect(
      sourcePageCommitSchema.parse({
        sourceId: "11111111-1111-4111-8111-111111111111",
        countryCode: "FR",
        mode: "backfill",
        checkpointIn: { version: "sprout.offset.v1", offset: 0 },
        checkpointOut: { version: "sprout.offset.v1", offset: 100 },
        complete: false,
        entries: [
          {
            canonical,
            contentHash: "a".repeat(64),
            fetchedAt: "2026-07-20T13:00:00+00:00",
            sourceDocument: { id: 123, title: "Software Engineer" },
            canonicalSourceUrl: null,
            canonicalApplyUrl: "https://example.com/jobs/123",
            atsPostingId: null,
            publishedAt: "2026-07-20T12:00:00+00:00",
            expiresAt: null,
            lifecycleState: "active",
            attribution: { provider: "sprout" },
            policyId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      }).entries[0]?.canonical,
    ).toEqual(canonical);
    expect(
      sourcePageCommitSchema.parse({
        sourceId: "11111111-1111-4111-8111-111111111111",
        countryCode: "FR",
        mode: "incremental",
        checkpointIn: { version: "sprout.offset.v1", offset: 100 },
        checkpointOut: { version: "sprout.offset.v1", offset: 100 },
        complete: true,
        entries: [],
      }).entries,
    ).toEqual([]);
    expect(() =>
      sourcePageCommitSchema.parse({
        sourceId: "11111111-1111-4111-8111-111111111111",
        countryCode: "FR",
        mode: "backfill",
        checkpointIn: {},
        checkpointOut: {},
        complete: false,
        entries: [{ canonical: { ...canonical, salaryMin: 80_000 } }],
      }),
    ).toThrow();
  });

  test("validates secret-reference-only Sprout runtime metadata", () => {
    const runtime = {
      sourceId: "11111111-1111-4111-8111-111111111111",
      sourceKey: "sprout:france",
      countryCode: "FR",
      policyId: "22222222-2222-4222-8222-222222222222",
      endpoint: "https://api.example.test/jobs",
      credentialRef: "secret://sprout/france-api",
      approvedPageSize: 100,
      checkpoint: {
        version: "sprout.offset.v1",
        offset: 0,
        pageSize: 100,
        observedTotal: null,
        watermark: null,
      },
      policyEvidenceRef: "policy/sprout/france/2026-07-21",
      canaryEvidence: {
        status: "pending",
        evidenceRef: null,
        pagesCommitted: 0,
        identityReadBack: false,
        rawSnapshotLinked: false,
        occurrenceLinked: false,
        checkpointReadBack: false,
        singleWriterVerified: false,
      },
      rollbackEvidence: {
        status: "pending",
        evidenceRef: null,
        providerKillSwitchVerified: false,
        sourceKillSwitchVerified: false,
        scheduleDisableVerified: false,
        transportDisableVerified: false,
        outstandingTasksStopVerified: false,
        writerClaimReleaseVerified: false,
      },
    } as const;
    expect(sproutSourceRuntimeSchema.parse(runtime)).toEqual(runtime);
    for (const credentialRef of [
      "Bearer token",
      "https://user:secret@example.test",
      "secret://Sprout/france",
    ]) {
      expect(() =>
        sproutSourceRuntimeSchema.parse({ ...runtime, credentialRef }),
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
      tenantSelectionEvidence: {
        reference: "ats-ranking/2026-07-20/greenhouse-hirly.json",
        sha256: "a".repeat(64),
      },
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
      {
        ...manifest,
        tenantSelectionEvidence: {
          ...manifest.tenantSelectionEvidence,
          sha256: "not-a-digest",
        },
      },
      {
        ...manifest,
        tenantSelectionEvidence: undefined,
      },
    ]) {
      expect(() => sourceTrialManifestSchema.parse(invalid)).toThrow();
    }
  });
});
