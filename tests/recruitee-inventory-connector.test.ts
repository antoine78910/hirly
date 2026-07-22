import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { providerSchema, type SourceRegistryEntry } from "../packages/contracts/src";
import {
  IngestionError,
  runIngestion,
  sourceActivationBlockReason,
  stableJobId,
  toCanonicalJob,
  type CanonicalJobRepository,
  type ProviderPage,
  type ProviderTransport,
  type SourceContext,
} from "../packages/ingestion/src";
import { assertProviderTransportActive, getProviderModule } from "../apps/worker/src/providers";
import {
  createRecruiteeFixtureSourceAdapter,
  createRecruiteeTrialTransport,
  recruiteeProvider,
  recruiteeRawJobSchema,
  type RecruiteeRawJob,
} from "../apps/worker/src/providers/recruitee";
import type { AtsTrialFetch } from "../apps/worker/src/providers/ats-trial-transport";

const fixturePolicyId = "00000000-0000-4000-8000-000000000019";
const fixedNow = new Date("2026-07-20T00:00:00.000Z");

interface RecruiteeFixture {
  provenance: {
    kind: "sanitized_official_documentation_example";
    source: string;
    containsPersonalData: false;
  };
  provider: "recruitee";
  tenantKey: string;
  countryCodes: string[];
  raw: RecruiteeRawJob[];
}

async function fixture(): Promise<RecruiteeFixture> {
  return JSON.parse(
    await readFile(new URL("./fixtures/g011/recruitee.json", import.meta.url), "utf8"),
  ) as RecruiteeFixture;
}

function source(data: RecruiteeFixture): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    provider: "recruitee",
    sourceKey: data.tenantKey,
    tenantKey: data.tenantKey,
    countryCodes: data.countryCodes,
    accessType: "public_api",
    policyId: fixturePolicyId,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    checkpoint: { fixturePageSize: 1 },
  };
}

function context(entry: SourceRegistryEntry): SourceContext {
  return { source: entry, runId: "recruitee-fixture", fetchedAt: fixedNow };
}

describe("Recruitee inventory connector", () => {
  test("registers the provider without enabling a transport or canonical writer", () => {
    expect(providerSchema.parse("recruitee")).toBe("recruitee");
    expect(getProviderModule("recruitee")).toBe(recruiteeProvider);
    expect(recruiteeProvider).toMatchObject({
      authorizationStatus: "unverified",
      liveTransportReady: false,
      shadowModeReady: true,
      canonicalWriteReady: false,
      rateLimit: { requestsPerMinute: 1, concurrency: 1 },
    });
    expect(recruiteeProvider.transport.constructor.name).toBe("DisabledProviderTransport");
    expect(() => assertProviderTransportActive("recruitee")).toThrow(
      "provider transport is inactive: recruitee",
    );
  });

  test("normalizes Recruitee public-offers UTC timestamps and rejects malformed values", async () => {
    const data = await fixture();
    const parsed = recruiteeRawJobSchema.parse({
      ...data.raw[0],
      published_at: "2026-07-21 10:11:12 UTC",
      created_at: "2026-07-20T09:08:07.123456",
    });

    expect(parsed.published_at).toBe("2026-07-21T10:11:12Z");
    expect(parsed.created_at).toBe("2026-07-20T09:08:07.123456Z");

    for (const published_at of [
      "2026-07-21 10:11:12",
      "2026-07-21 10:11:12 utc",
      "2026-07-21 10:11:12 UTC ",
      "2026-07-21T10:11",
      "2026-07-21T10:11:12UTC",
    ]) {
      expect(() => recruiteeRawJobSchema.parse({ ...data.raw[0], published_at })).toThrow();
    }
  });

  test("normalizes live public-offers UTC timestamps before offer validation", async () => {
    const response = JSON.parse(
      await readFile(
        new URL("./fixtures/g011/recruitee-public-offers-offsetless.json", import.meta.url),
        "utf8",
      ),
    );
    const transport = createRecruiteeTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: async () => new Response(JSON.stringify(response), { status: 200 }),
    });

    await expect(transport.fetch(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        published_at: "2026-07-21T10:11:12Z",
        created_at: "2026-07-20T09:08:07Z",
      }),
    ]);

    const malformed = createRecruiteeTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: async () =>
        new Response(
          JSON.stringify({
            ...response,
            offers: [{ ...response.offers[0], published_at: "2026-07-21T10:11:12UTC" }],
          }),
          { status: 200 },
        ),
    });
    await expect(malformed.fetch(new AbortController().signal)).rejects.toMatchObject({
      classification: "malformed",
    });
  });

  test("normalizes frozen fixture identity, URL, country and fulfillment parity", async () => {
    const data = await fixture();
    const rows = data.raw.map((raw) => recruiteeRawJobSchema.parse(raw));
    const entry = source(data);
    const adapter = createRecruiteeFixtureSourceAdapter(rows, fixturePolicyId);
    const occurrence = adapter.normalize(rows[0], context(entry));
    const canonical = toCanonicalJob(occurrence.job, fixedNow);

    expect(data.provenance.containsPersonalData).toBe(false);
    expect(occurrence).toMatchObject({
      externalId: "vaulttec:4401",
      canonicalSourceUrl: "https://vaulttec.recruitee.com/o/ingenieur-plateforme",
      canonicalApplyUrl: "https://vaulttec.recruitee.com/o/ingenieur-plateforme",
      atsPostingId: "4401",
      job: {
        title: "Ingénieur plateforme",
        company: "Vault-Tec",
        location: "Paris, France",
        countryCode: "FR",
        contractType: "full_time",
        description: "Construire des services fiables.",
      },
    });
    expect(canonical.jobId).toBe(stableJobId("recruitee", "vaulttec:4401"));
    expect(canonical.jobId).toBe("job_50b64f88b279b00b");
    expect(canonical.selectedApplyUrl).toBe(occurrence.canonicalApplyUrl);
    expect(canonical.validationStatus).toBe("valid");
    expect(canonical.applyabilityTier).toBe("B");
    expect(canonical.manualFulfillmentReady).toBe(true);
    expect(canonical.autoApplySupported).toBe(false);
    expect(canonical.fingerprint).toMatch(/^[0-9a-f]{40}$/);

    const countryFallback = adapter.normalize(rows[1], context(entry));
    expect(countryFallback.job.countryCode).toBe("FR");
    expect(countryFallback.job.location).toBe("Lyon");
  });

  test("emits explicit complete checkpoints and never expires from a failed partial scope", async () => {
    const data = await fixture();
    const rows = data.raw.map((raw) => recruiteeRawJobSchema.parse(raw));
    const entry = source(data);
    const adapter = createRecruiteeFixtureSourceAdapter(rows, fixturePolicyId);
    const pages = [];
    for await (const page of adapter.discover({
      source: entry,
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      complete: false,
      nextCursor: { version: "g011-fixture-v1", offset: 1 },
    });
    expect(pages[1]).toMatchObject({ complete: true, nextCursor: null });
    expect(adapter.validateActive(rows[0], fixedNow).reason).toContain("complete successful scope");

    const invalid = adapter.discover({
      source: entry,
      mode: "full",
      cursor: { version: "g011-fixture-v1", offset: 99 },
      signal: new AbortController().signal,
    });
    await expect(invalid[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(IngestionError);
  });

  test("rejects lookalike, credentialed, queried and cross-offer URLs", async () => {
    const data = await fixture();
    const original = recruiteeRawJobSchema.parse(data.raw[0]);
    const entry = source(data);
    const adapter = createRecruiteeFixtureSourceAdapter([original], fixturePolicyId);
    for (const careers_url of [
      "http://vaulttec.recruitee.com/o/ingenieur-plateforme",
      "https://user:password@vaulttec.recruitee.com/o/ingenieur-plateforme",
      "https://vaulttec.recruitee.com.evil.example/o/ingenieur-plateforme",
      "https://other.recruitee.com/o/ingenieur-plateforme",
      "https://vaulttec.recruitee.com/o/another-offer",
      "https://vaulttec.recruitee.com/o/ingenieur-plateforme?token=secret",
    ]) {
      expect(() => adapter.normalize({ ...original, careers_url }, context(entry))).toThrow(
        IngestionError,
      );
    }
  });

  test("deduplicates repeated provider identities before the canonical upsert", async () => {
    const data = await fixture();
    const raw = recruiteeRawJobSchema.parse(data.raw[0]);
    const transport: ProviderTransport<RecruiteeRawJob> = {
      async fetch(): Promise<ProviderPage<RecruiteeRawJob>> {
        return { items: [raw, { ...raw }], nextCursor: null };
      },
    };
    const writes: unknown[][] = [];
    const repository: CanonicalJobRepository = {
      async upsertCanonicalBatch(jobs) {
        writes.push(jobs);
        return jobs.length;
      },
    };
    const result = await runIngestion({
      provider: "recruitee",
      transport,
      adapter: recruiteeProvider.adapter,
      repository,
      request: {
        provider: "recruitee",
        query: null,
        location: null,
        countryCode: "FR",
        cursor: null,
        pageSize: 50,
        maxPages: 1,
      },
      rateLimit: recruiteeProvider.rateLimit,
      now: () => fixedNow,
    });
    expect(result.metrics).toMatchObject({
      fetched: 2,
      accepted: 1,
      deduplicated: 1,
      rejected: 0,
      upserted: 1,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(1);
  });

  test("redacts provider-side contact canaries from the retained source document", async () => {
    const data = await fixture();
    const raw = recruiteeRawJobSchema.parse({
      ...data.raw[0],
      contact_email: "recruiter@example.test",
      recruiter_phone: "+33 6 12 34 56 78",
      authorization_token: "never-persist-this",
    });
    const canonical = toCanonicalJob(recruiteeProvider.adapter.normalizeRaw(raw), fixedNow);
    expect(canonical.data).toMatchObject({
      contact_email: "[REDACTED]",
      recruiter_phone: "[REDACTED]",
      authorization_token: "[REDACTED]",
    });
    expect(JSON.stringify(canonical.data)).not.toContain("recruiter@example.test");
    expect(JSON.stringify(canonical.data)).not.toContain("never-persist-this");
  });

  test("keeps provider/country rollback and writer ownership fail-closed", async () => {
    const data = await fixture();
    const entry = source(data);
    const base = {
      providerEnabled: true,
      providerAuthorizationStatus: "authorized" as const,
      writerRuntime: "typescript" as const,
      providerCountryKillSwitches: {},
      sourceCountryKillSwitches: {},
      source: {
        ...entry,
        enabled: true,
        transportEnabled: true,
        incrementalEnabled: true,
      },
      policy: {
        approvalStatus: "approved" as const,
        enabled: true,
        commercialUseAllowed: true,
        redisplayAllowed: true,
        fullTextRetentionAllowed: true,
        enabledEnvironments: ["production" as const],
        permittedAccessMethods: ["public_api" as const],
        expiresAt: "2026-07-21T00:00:00.000Z",
      },
    };
    expect(sourceActivationBlockReason(base, "FR", "incremental", fixedNow)).toBeNull();
    expect(
      sourceActivationBlockReason(
        { ...base, providerEnabled: false },
        "FR",
        "incremental",
        fixedNow,
      ),
    ).toBe("provider_disabled");
    expect(
      sourceActivationBlockReason(
        { ...base, writerRuntime: "python" },
        "FR",
        "incremental",
        fixedNow,
      ),
    ).toBe("writer_not_typescript");
    expect(
      sourceActivationBlockReason(
        { ...base, providerCountryKillSwitches: { FR: true } },
        "FR",
        "incremental",
        fixedNow,
      ),
    ).toBe("provider_country_killed");
  });

  test("builds a one-request credential-free trial transport on the approved tenant host", async () => {
    const data = await fixture();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch: AtsTrialFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ offers: data.raw }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = createRecruiteeTrialTransport({
      approvedTenantId: data.tenantKey,
      fetch,
    });
    expect(await transport.fetch(new AbortController().signal)).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://vaulttec.recruitee.com/api/offers/?format=json",
      init: {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    });
    expect(transport).toMatchObject({
      trialOnly: true,
      manualInvocationOnly: true,
      liveTransportReady: false,
      canonicalWriteReady: false,
      credentialsAccepted: false,
      approvedTenantId: "vaulttec",
      budgets: { maxRequests: 1, maxPages: 1 },
    });
    for (const approvedTenantId of [
      "../other",
      "tenant?token=secret",
      "https://evil.example",
      "tenant.name",
      "careers",
    ]) {
      expect(() => createRecruiteeTrialTransport({ approvedTenantId })).toThrow();
    }
  });

  test("fails closed on Recruitee trial schema drift and byte budgets", async () => {
    const drifted = createRecruiteeTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: async () => new Response(JSON.stringify({ offers: [{ id: 1 }] }), { status: 200 }),
    });
    await expect(drifted.fetch(new AbortController().signal)).rejects.toMatchObject({
      classification: "malformed",
    });

    const oversized = createRecruiteeTrialTransport({
      approvedTenantId: "vaulttec",
      budgets: { maxBytes: 8 },
      fetch: async () =>
        new Response(JSON.stringify({ offers: [] }), {
          status: 200,
          headers: { "content-length": "999" },
        }),
    });
    await expect(oversized.fetch(new AbortController().signal)).rejects.toMatchObject({
      classification: "budget_exceeded",
    });
  });
});
