import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  sourceRuntimePolicySchema,
  type CanonicalJob,
  type SourceRuntimePolicy,
} from "../packages/contracts/src";
import {
  runIngestion,
  sanitizeSourceDocument,
  sourceActivationBlockReason,
  stableJobId,
  type CanonicalJobRepository,
  type NormalizedProviderJob,
} from "../packages/ingestion/src";
import {
  AtsTrialTransportError,
  DEFAULT_ATS_TRIAL_BUDGETS,
  fetchBoundedAtsJson,
  type AtsTrialFetch,
} from "../apps/worker/src/providers/ats-trial-transport";

const repoRoot = join(import.meta.dir, "..");
const now = new Date("2026-07-21T12:00:00.000Z");
const unusedResponseSchema = {
  safeParse(value: unknown) {
    return { success: true as const, data: value };
  },
} as never;

function runtimePolicy(): SourceRuntimePolicy {
  return sourceRuntimePolicySchema.parse({
    providerEnabled: true,
    providerAuthorizationStatus: "authorized",
    writerRuntime: "typescript",
    providerCountryKillSwitches: {},
    sourceCountryKillSwitches: {},
    source: {
      id: "018f02d8-a8b8-7f1d-a419-bf38eaf22a90",
      provider: "greenhouse",
      sourceKey: "greenhouse:vaulttec",
      tenantKey: "vaulttec",
      countryCodes: ["FR"],
      accessType: "public_api",
      policyId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a91",
      enabled: true,
      transportEnabled: true,
      incrementalEnabled: true,
      backfillEnabled: true,
      checkpoint: null,
    },
    policy: {
      approvalStatus: "approved",
      enabled: true,
      commercialUseAllowed: true,
      redisplayAllowed: true,
      fullTextRetentionAllowed: true,
      enabledEnvironments: ["production"],
      permittedAccessMethods: ["public_api"],
      expiresAt: "2026-07-22T12:00:00.000Z",
    },
  });
}

function normalizedGreenhouseJob(externalId: string): NormalizedProviderJob {
  return {
    envelope: {
      provider: "greenhouse",
      externalId,
      payload: {
        id: externalId,
        title: "Security Engineer",
        absolute_url: `https://boards.greenhouse.io/vaulttec/jobs/${externalId}`,
      },
    },
    title: "Security Engineer",
    company: "Vault Tec",
    location: "Paris, France",
    countryCode: "FR",
    description: "Protect the canonical ingestion boundary.",
    contractType: "CDI",
    status: "open",
    applyUrls: [
      `https://boards.greenhouse.io/vaulttec/jobs/${externalId}`,
    ],
  };
}

describe("G019 adversarial ATS transport and policy release gates", () => {
  test("rejects SSRF and URL-confusion inputs before invoking fetch", async () => {
    let fetchCalls = 0;
    const fetch: AtsTrialFetch = async () => {
      fetchCalls += 1;
      return Response.json({ jobs: [] });
    };
    const hostileUrls = [
      "http://boards-api.greenhouse.io/v1/boards/vaulttec/jobs",
      "https://boards-api.greenhouse.io.evil.test/v1/boards/vaulttec/jobs",
      "https://boards-api.greenhouse.io@evil.test/v1/boards/vaulttec/jobs",
      "https://user:password@boards-api.greenhouse.io/v1/boards/vaulttec/jobs",
      "https://boards-api.greenhouse.io:444/v1/boards/vaulttec/jobs",
      "https://127.0.0.1/v1/boards/vaulttec/jobs",
      "https://[::1]/v1/boards/vaulttec/jobs",
      "https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs#redirect",
    ];

    for (const value of hostileUrls) {
      await expect(
        fetchBoundedAtsJson({
          url: new URL(value),
          allowedHost: "boards-api.greenhouse.io",
          fetch,
          budgets: DEFAULT_ATS_TRIAL_BUDGETS,
          schema: unusedResponseSchema,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        name: "AtsTrialTransportError",
        classification: "permanent",
      });
    }
    expect(fetchCalls).toBe(0);
  });

  test("denies redirects and omits credentials for an approved official URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await expect(
      fetchBoundedAtsJson({
        url: new URL(
          "https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs?content=true",
        ),
        allowedHost: "boards-api.greenhouse.io",
        fetch: async (url, init) => {
          calls.push({ url, init });
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          });
        },
        budgets: DEFAULT_ATS_TRIAL_BUDGETS,
        schema: unusedResponseSchema,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(AtsTrialTransportError);

    expect(calls).toEqual([
      {
        url: "https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs?content=true",
        init: expect.objectContaining({
          method: "GET",
          redirect: "error",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        }),
      },
    ]);
  });

  test("fails closed on policy expiry and provider/source country kill switches", () => {
    expect(sourceActivationBlockReason(runtimePolicy(), "fr", "incremental", now)).toBeNull();

    const expired = runtimePolicy();
    expired.policy.expiresAt = now.toISOString();
    expect(sourceActivationBlockReason(expired, "FR", "incremental", now)).toBe(
      "policy_expired",
    );

    const providerKilled = runtimePolicy();
    providerKilled.providerCountryKillSwitches.FR = true;
    expect(
      sourceActivationBlockReason(providerKilled, "FR", "incremental", now),
    ).toBe("provider_country_killed");

    const sourceKilled = runtimePolicy();
    sourceKilled.sourceCountryKillSwitches.FR = true;
    expect(
      sourceActivationBlockReason(sourceKilled, "FR", "incremental", now),
    ).toBe("source_country_killed");

    const wrongWriter = runtimePolicy();
    wrongWriter.writerRuntime = "python";
    expect(
      sourceActivationBlockReason(wrongWriter, "FR", "incremental", now),
    ).toBe("writer_not_typescript");
  });

  test("redacts nested PII, credentials, tokens, and secret query values", () => {
    const piiCanary = "candidate.canary+g019@example.test";
    const sanitized = sanitizeSourceDocument({
      recruiter_email: piiCanary,
      candidate: {
        first_name: "CandidateCanary",
        phone: "+33 6 12 34 56 78",
      },
      authorization: "Bearer ats.secret.token",
      databaseUrl: "postgresql://worker:super-secret@db.example.test/jobs",
      publicDescription: [
        `Contact ${piiCanary}`,
        "https://example.test/apply?token=super-secret&job=42",
      ],
    });
    const serialized = JSON.stringify(sanitized);

    for (const secret of [
      piiCanary,
      "CandidateCanary",
      "+33 6 12 34 56 78",
      "ats.secret.token",
      "worker:super-secret",
      "token=super-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[REDACTED_EMAIL]");
  });
});

describe("G019 canonical write, retry, and rollback safety", () => {
  test("does not write or expire inventory when a later page fails", async () => {
    let fetches = 0;
    let writes = 0;
    const repository: CanonicalJobRepository = {
      async upsertCanonicalBatch() {
        writes += 1;
        return 1;
      },
    };

    await expect(
      runIngestion({
        provider: "greenhouse",
        transport: {
          async fetch() {
            fetches += 1;
            if (fetches === 1) {
              return {
                items: [{ externalId: "vaulttec:42" }],
                nextCursor: "page-2",
              };
            }
            throw new Error("synthetic provider failure");
          },
        },
        adapter: {
          provider: "greenhouse",
          normalizeRaw(raw: { externalId: string }) {
            return normalizedGreenhouseJob(raw.externalId);
          },
        },
        repository,
        request: {
          provider: "greenhouse",
          query: null,
          location: null,
          countryCode: "FR",
          cursor: null,
          pageSize: 50,
          maxPages: 2,
        },
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      }),
    ).rejects.toThrow("synthetic provider failure");
    expect(writes).toBe(0);
  });

  test("repeated complete ingestion keeps one stable provider identity", async () => {
    const rows = new Map<string, CanonicalJob>();
    const repository: CanonicalJobRepository = {
      async upsertCanonicalBatch(jobs) {
        for (const job of jobs) rows.set(`${job.provider}:${job.externalId}`, job);
        return jobs.length;
      },
    };
    const execute = () =>
      runIngestion({
        provider: "greenhouse",
        transport: {
          async fetch() {
            return {
              items: [
                { externalId: "vaulttec:42" },
                { externalId: "vaulttec:42" },
              ],
              nextCursor: null,
            };
          },
        },
        adapter: {
          provider: "greenhouse",
          normalizeRaw(raw: { externalId: string }) {
            return normalizedGreenhouseJob(raw.externalId);
          },
        },
        repository,
        request: {
          provider: "greenhouse",
          query: null,
          location: null,
          countryCode: "FR",
          cursor: null,
          pageSize: 50,
          maxPages: 1,
        },
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        now: () => now,
      });

    const first = await execute();
    const repeat = await execute();
    expect(first.metrics).toMatchObject({ accepted: 1, deduplicated: 1, upserted: 1 });
    expect(repeat.metrics).toMatchObject({ accepted: 1, deduplicated: 1, upserted: 1 });
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]?.jobId).toBe(
      stableJobId("greenhouse", "vaulttec:42"),
    );
  });

  test("ownership transfer invalidates stale claims and rollback is explicit", async () => {
    const migration = await readFile(
      join(
        repoRoot,
        "backend/db/migrations/20260720000700_provider_ownership_epochs.sql",
      ),
      "utf8",
    );
    const rollback = await readFile(
      join(
        repoRoot,
        "backend/db/migrations/20260720000700_provider_ownership_epochs.down.sql",
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /transition_provider_writer[\s\S]*FOR UPDATE[\s\S]*provider writer must transition through none[\s\S]*enabled = false[\s\S]*ownership_epoch = ownership_epoch \+ 1/i,
    );
    expect(migration).toMatch(
      /write_jobs_and_complete[\s\S]*claim\.expires_at > clock_timestamp\(\)[\s\S]*registry\.writer_runtime = 'typescript'[\s\S]*registry\.ownership_epoch = claim\.ownership_epoch/i,
    );
    expect(rollback).toContain(
      "-- Operational rollback: stop/drain writers before applying.",
    );
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS worker_private.transition_provider_writer",
    );
    expect(rollback).toContain(
      "DROP TABLE IF EXISTS public.provider_work_claims",
    );
  });
});
