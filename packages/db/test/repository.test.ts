import { describe, expect, test } from "bun:test";
import { type Database, WorkerRepository } from "../src";

describe("database repository boundary", () => {
  test("exports only named operations, not arbitrary state mutation", () => {
    const methods = Object.getOwnPropertyNames(WorkerRepository.prototype);
    expect(methods).toContain("claim");
    expect(methods).toContain("heartbeat");
    expect(methods).toContain("finish");
    expect(methods).toContain("writeJobAndComplete");
    expect(methods).toContain("commitSproutSourcePage");
    expect(methods).toContain("getSproutSourceRuntime");
    expect(methods).not.toContain("updateTask");
    expect(methods).not.toContain("query");
  });

  test("reads only runnable secret-reference Sprout source metadata", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const tag = ((strings: TemplateStringsArray, ...parameters: unknown[]) => {
      statements.push(strings.join("?"));
      values.push(parameters);
      return Promise.resolve([
        {
          source_id: "11111111-1111-4111-8111-111111111111",
          source_key: "sprout:france",
          country_code: "FR",
          policy_id: "22222222-2222-4222-8222-222222222222",
          endpoint: "https://api.example.test/jobs",
          credential_ref: "secret://sprout/france-api",
          approved_page_size: 100,
          checkpoint: {
            version: "sprout.offset.v1",
            offset: 0,
            pageSize: 100,
          },
          policy_evidence_ref: "policy/sprout/france/2026-07-21",
          canary_evidence: {
            status: "pending",
            evidenceRef: null,
            pagesCommitted: 0,
            identityReadBack: false,
            rawSnapshotLinked: false,
            occurrenceLinked: false,
            checkpointReadBack: false,
            singleWriterVerified: false,
          },
          rollback_evidence: {
            status: "pending",
            evidenceRef: null,
            providerKillSwitchVerified: false,
            sourceKillSwitchVerified: false,
            scheduleDisableVerified: false,
            transportDisableVerified: false,
            outstandingTasksStopVerified: false,
            writerClaimReleaseVerified: false,
          },
        },
      ]);
    }) as unknown as Database;
    tag.json = (value) => value as never;

    const runtime = await new WorkerRepository(tag).getSproutSourceRuntime(
      "11111111-1111-4111-8111-111111111111",
      "backfill",
    );

    expect(statements[0]).toContain(
      "worker_private.get_sprout_source_runtime_v2",
    );
    expect(values[0]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "backfill",
    ]);
    expect(runtime).toMatchObject({
      sourceKey: "sprout:france",
      credentialRef: "secret://sprout/france-api",
      approvedPageSize: 100,
    });
  });

  test("commits a validated Sprout page through one scoped RPC", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const tag = ((strings: TemplateStringsArray, ...parameters: unknown[]) => {
      statements.push(strings.join("?"));
      values.push(parameters);
      return Promise.resolve([
        {
          commit_sprout_source_page: {
            snapshotsInserted: 1,
            canonicalUpserts: 1,
            occurrencesUpserted: 1,
            groupsCreated: 1,
            checkpoint: { version: "sprout.offset.v1", offset: 100 },
          },
        },
      ]);
    }) as unknown as Database;
    tag.json = (value) => value as never;

    const result = await new WorkerRepository(tag).commitSproutSourcePage(
      {
        taskId: "11111111-1111-4111-8111-111111111111",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        claimGeneration: 1n,
        leaseOwner: "worker-1",
      },
      {
        claimId: "33333333-3333-4333-8333-333333333333",
        provider: "sprout",
        runtime: "typescript",
        ownershipEpoch: 1n,
        expiresAt: new Date("2026-07-20T14:00:00Z"),
      },
      {
        sourceId: "44444444-4444-4444-8444-444444444444",
        countryCode: "FR",
        mode: "backfill",
        checkpointIn: { version: "sprout.offset.v1", offset: 0 },
        checkpointOut: { version: "sprout.offset.v1", offset: 100 },
        complete: false,
        entries: [
          {
            canonical: {
              jobId: "job_0123456789abcdef",
              provider: "sprout",
              externalId: "123",
              title: "Software Engineer",
              normalizedTitle: "software engineer",
              company: "Example SAS",
              normalizedCompany: "example",
              location: "Paris, France",
              countryCode: "FR",
              selectedApplyUrl: "https://example.com/jobs/123",
              validationStatus: "valid",
              validationReason: "fixture",
              validationCheckedAt: "2026-07-20T13:00:00+00:00",
              applyabilityTier: "B",
              applyabilityScore: 0.8,
              applyFulfillmentStatus: "manual_ready",
              applyUrlProvider: "example",
              atsProvider: "unknown",
              requiresLogin: false,
              requiresAccountCreation: false,
              captchaDetected: false,
              manualFulfillmentReady: true,
              autoApplySupported: false,
              rejectionReason: null,
              fingerprint: "fixture-fingerprint",
              data: {},
            },
            contentHash: "a".repeat(64),
            fetchedAt: "2026-07-20T13:00:00+00:00",
            sourceDocument: { id: 123 },
            canonicalSourceUrl: null,
            canonicalApplyUrl: "https://example.com/jobs/123",
            atsPostingId: null,
            publishedAt: null,
            expiresAt: null,
            lifecycleState: "active",
            attribution: {},
            policyId: "55555555-5555-4555-8555-555555555555",
          },
        ],
      },
    );

    expect(statements[0]).toContain("worker_private.commit_sprout_source_page");
    expect(values[0]?.[5]).toBe("44444444-4444-4444-8444-444444444444");
    expect(result).toMatchObject({ canonicalUpserts: 1, occurrencesUpserted: 1 });
  });

  test("registers a validated disabled career source through the private RPC", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const tag = ((
      strings: TemplateStringsArray,
      ...parameters: unknown[]
    ) => {
      statements.push(strings.join("?"));
      values.push(parameters);
      return Promise.resolve([
        {
          id: "11111111-1111-4111-8111-111111111111",
          provider: "greenhouse",
          source_key: "greenhouse:hirly",
          tenant_key: "hirly",
          company_id: null,
          company_name: "Hirly",
          country_codes: ["FR"],
          base_url: "https://boards.greenhouse.io/hirly",
          access_type: "tenant_feed",
          policy_id: null,
          sync_frequency_seconds: 3600,
          checkpoint: { version: "ats-discovery.v1" },
          last_attempt_at: null,
          last_success_at: null,
          last_complete_run_id: null,
          consecutive_failures: 0,
          enabled: false,
          transport_enabled: false,
          incremental_enabled: false,
          backfill_enabled: false,
          discovery_state: "candidate",
        },
      ]);
    }) as unknown as Database;
    tag.json = (value) => value as never;

    const candidate = await new WorkerRepository(
      tag,
    ).registerCareerSourceCandidate({
      provider: "greenhouse",
      sourceKey: "greenhouse:hirly",
      tenantKey: "hirly",
      companyId: null,
      companyName: "Hirly",
      countryCodes: ["FR"],
      baseUrl: "https://boards.greenhouse.io/hirly",
      accessType: "tenant_feed",
      syncFrequencySeconds: 3600,
      checkpoint: { version: "ats-discovery.v1" },
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      "worker_private.register_career_source_candidate",
    );
    expect(values[0]?.slice(0, 3)).toEqual([
      "greenhouse",
      "greenhouse:hirly",
      "hirly",
    ]);
    expect(candidate).toMatchObject({
      provider: "greenhouse",
      tenantKey: "hirly",
      enabled: false,
      transportEnabled: false,
      incrementalEnabled: false,
      backfillEnabled: false,
      discoveryState: "candidate",
    });
  });
});
