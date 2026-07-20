import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  ProviderRateGate,
  runIngestion,
  stableJobId,
  toCanonicalJob,
  type CanonicalJobRepository,
  type ProviderPage,
  type ProviderTransport,
} from "../packages/ingestion/src/index";
import { providerModules } from "../apps/worker/src/providers";
import type { ProviderCore } from "../apps/worker/src/providers/core";
import type {
  CanonicalJob,
  Provider,
  ProviderSearchRequest,
} from "../packages/contracts/src/index";

const providers = ["apec", "hellowork", "wttj", "indeed"] as const;
const fixtureRoot = new URL("./fixtures/g004/", import.meta.url);
const fixedNow = new Date("2026-07-20T00:00:00.000Z");

type Fixture = {
  schemaVersion: "hirly.provider-fixture.v1";
  provenance: {
    kind: "synthetic_sanitized";
    approvalRef: ".omx/plans/prd-nextjs-bun-foundation.md#phase-4";
    containsPersonalData: false;
  };
  provider: Provider;
  externalId: string;
  title: string;
  company: string;
  location: string;
  countryCode: string;
  description: string;
  contractType: string | null;
  status: string | null;
  applyUrls: string[];
  sourceDocument: Record<string, unknown>;
};

async function loadFixture(provider: Provider): Promise<Fixture> {
  return JSON.parse(
    await readFile(new URL(`${provider}.json`, fixtureRoot), "utf8"),
  ) as Fixture;
}

function request(provider: Provider): ProviderSearchRequest {
  return {
    provider,
    query: "engineering",
    location: "France",
    countryCode: "FR",
    cursor: null,
    pageSize: 50,
    maxPages: 5,
  };
}

class MemoryRepository implements CanonicalJobRepository {
  readonly rows = new Map<string, CanonicalJob>();
  calls = 0;

  async upsertCanonicalBatch(jobs: CanonicalJob[]): Promise<number> {
    this.calls += 1;
    for (const job of jobs) {
      this.rows.set(`${job.provider}:${job.externalId}`, job);
    }
    return jobs.length;
  }
}

describe("G004 stable canonical identity and normalization", () => {
  test("matches frozen Python SHA-1 vectors without implicit ID trimming", () => {
    expect(stableJobId("apec", "123")).toBe("job_7168250cba955547");
    expect(stableJobId("apec", " 123 ")).toBe("job_ef15c8ba7c19df18");
    expect(stableJobId("hellowork", "éxterne-42")).toBe(
      "job_837bf2604f073d51",
    );
    expect(stableJobId("indeed", "same")).toBe("job_321fefdcd17f3790");
    expect(stableJobId("wttj", "same")).toBe("job_a2f8696030a40817");
  });

  test("normalizes every approved synthetic fixture into the canonical contract", async () => {
    for (const provider of providers) {
      const fixture = await loadFixture(provider);
      const core = providerModules[provider] as ProviderCore<Fixture>;
      const normalized = core.adapter.normalizeRaw(fixture);
      const job = toCanonicalJob(normalized, fixedNow);

      expect(job.provider).toBe(provider);
      expect(job.externalId).toBe(fixture.externalId);
      expect(job.jobId).toBe(stableJobId(provider, fixture.externalId));
      expect(job.countryCode).toBe("FR");
      expect(job.normalizedTitle.length).toBeGreaterThan(0);
      expect(job.normalizedCompany).not.toMatch(/\b(sa|sas|sarl|gmbh)\b/);
      expect(job.validationCheckedAt).toBe(fixedNow.toISOString());
      expect(job.fingerprint).toMatch(/^[0-9a-f]{40}$/);
      expect(job.data).toEqual(fixture);
      expect(job.data.sourceDocument).toEqual(fixture.sourceDocument);
    }
  });

  test("selects a direct ATS deterministically and exposes fulfillment readiness", async () => {
    const fixture = await loadFixture("apec");
    const normalized = providerModules.apec.adapter.normalizeRaw(fixture);
    const job = toCanonicalJob(normalized, fixedNow);

    expect(job.selectedApplyUrl).toBe(
      "https://boards.greenhouse.io/example/jobs/001",
    );
    expect(job.validationStatus).toBe("valid");
    expect(job.applyabilityTier).toBe("A");
    expect(job.atsProvider).toBe("greenhouse");
    expect(job.applyUrlProvider).toBe("greenhouse");
    expect(job.manualFulfillmentReady).toBeTrue();
    expect(job.autoApplySupported).toBeTrue();
  });

  test("keeps fingerprints stable across non-semantic source-document ordering", async () => {
    const fixture = await loadFixture("hellowork");
    const reordered = {
      ...fixture,
      sourceDocument: {
        remote: fixture.sourceDocument.remote,
        fixture: fixture.sourceDocument.fixture,
      },
    };
    const adapter = providerModules.hellowork.adapter;
    expect(
      toCanonicalJob(adapter.normalizeRaw(fixture), fixedNow).fingerprint,
    ).toBe(
      toCanonicalJob(adapter.normalizeRaw(reordered), fixedNow).fingerprint,
    );
  });
});

describe("G004 provider core authorization and fixture contracts", () => {
  test("keeps every transport disabled and refuses before any network implementation", async () => {
    for (const provider of providers) {
      const core = providerModules[provider];
      expect(core.coreReady).toBeTrue();
      expect(core.liveTransportReady).toBeFalse();
      expect(core.rateLimit).toEqual({
        requestsPerMinute: 1,
        concurrency: 1,
      });
      await expect(
        core.transport.fetch(request(provider), new AbortController().signal),
      ).rejects.toMatchObject({
        name: "IngestionError",
        code: "authorization_blocked",
      });
    }
  });

  test("records the approved initial authorization matrix", () => {
    expect(providerModules.apec.authorizationStatus).toBe("unverified");
    expect(providerModules.hellowork.authorizationStatus).toBe("unverified");
    expect(providerModules.wttj.authorizationStatus).toBe("blocked");
    expect(providerModules.indeed.authorizationStatus).toBe("blocked");
    for (const provider of providers) {
      expect(providerModules[provider].activationRequirements).toContain(
        "assign exactly one TypeScript canonical writer",
      );
    }
  });

  test("rejects malformed and cross-provider fixture payloads", async () => {
    const fixture = await loadFixture("apec");
    expect(() =>
      providerModules.apec.adapter.normalizeRaw({
        ...fixture,
        title: "",
      }),
    ).toThrow();
    expect(() =>
      providerModules.apec.adapter.normalizeRaw({
        ...fixture,
        provider: "indeed",
      }),
    ).toThrow();
  });

  test("provider-specific modules have no database import", async () => {
    const sourceRoot = new URL("../apps/worker/src/providers/", import.meta.url);
    for (const path of [
      "core.ts",
      "apec/index.ts",
      "hellowork/index.ts",
      "wttj/index.ts",
      "indeed/index.ts",
    ]) {
      const source = await readFile(new URL(path, sourceRoot), "utf8");
      expect(source).not.toContain("@hirly/db");
      expect(source).not.toMatch(/upsert|insert|updateCanonical/i);
    }
  });
});

describe("G004 provider-neutral ingestion behavior", () => {
  test("paginates, deduplicates, writes one canonical batch, and reconciles metrics", async () => {
    const fixture = await loadFixture("apec");
    const duplicate = structuredClone(fixture);
    const second = {
      ...structuredClone(fixture),
      externalId: "apec-002",
      title: "Backend Engineer",
    };
    const pages = new Map<string | null, ProviderPage<Fixture>>([
      [null, { items: [fixture, duplicate], nextCursor: "page-2" }],
      ["page-2", { items: [second], nextCursor: null }],
    ]);
    const transport: ProviderTransport<Fixture> = {
      async fetch(pageRequest) {
        return pages.get(pageRequest.cursor) ?? { items: [], nextCursor: null };
      },
    };
    const repository = new MemoryRepository();
    let emittedMetrics: unknown;

    const result = await runIngestion({
      provider: "apec",
      transport,
      adapter: providerModules.apec.adapter,
      repository,
      request: request("apec"),
      rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      now: () => fixedNow,
      onMetrics: (metrics) => {
        emittedMetrics = metrics;
      },
    });

    expect(result.jobs.map((job) => job.externalId)).toEqual([
      "apec-001",
      "apec-002",
    ]);
    expect(repository.calls).toBe(1);
    expect(repository.rows.size).toBe(2);
    expect(result.metrics).toMatchObject({
      fetched: 3,
      accepted: 2,
      rejected: 0,
      deduplicated: 1,
      upserted: 2,
      pages: 2,
    });
    expect(emittedMetrics).toEqual(result.metrics);
    expect(
      result.metrics.accepted +
        result.metrics.rejected +
        result.metrics.deduplicated,
    ).toBe(result.metrics.fetched);
  });

  test("is idempotent when the same fixture run is repeated", async () => {
    const fixture = await loadFixture("hellowork");
    const repository = new MemoryRepository();
    const transport: ProviderTransport<Fixture> = {
      async fetch() {
        return { items: [fixture], nextCursor: null };
      },
    };
    const input = {
      provider: "hellowork" as const,
      transport,
      adapter: providerModules.hellowork.adapter,
      repository,
      request: request("hellowork"),
      rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      now: () => fixedNow,
    };

    await runIngestion(input);
    await runIngestion(input);

    expect(repository.calls).toBe(2);
    expect(repository.rows.size).toBe(1);
    expect(repository.rows.get("hellowork:hellowork-001")?.jobId).toBe(
      stableJobId("hellowork", "hellowork-001"),
    );
  });

  test("rejects pipeline identity mismatch before transport or canonical writes", async () => {
    let fetches = 0;
    const repository = new MemoryRepository();
    await expect(
      runIngestion({
        provider: "wttj",
        transport: {
          async fetch() {
            fetches += 1;
            return { items: [], nextCursor: null };
          },
        },
        adapter: providerModules.indeed.adapter,
        repository,
        request: request("wttj"),
        rateLimit: { requestsPerMinute: 1, concurrency: 1 },
      }),
    ).rejects.toMatchObject({
      code: "integrity_error",
    });
    expect(fetches).toBe(0);
    expect(repository.calls).toBe(0);
  });

  test("fails closed on a repeated cursor without writing a partial batch", async () => {
    const fixture = await loadFixture("wttj");
    const repository = new MemoryRepository();
    await expect(
      runIngestion({
        provider: "wttj",
        transport: {
          async fetch(pageRequest) {
            return {
              items: [fixture],
              nextCursor: pageRequest.cursor ?? "repeat",
            };
          },
        },
        adapter: providerModules.wttj.adapter,
        repository,
        request: request("wttj"),
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        now: () => fixedNow,
      }),
    ).rejects.toMatchObject({
      code: "provider_permanent",
      message: "provider cursor repeated: repeat",
    });
    expect(repository.calls).toBe(0);
  });

  test("classifies missing, expired, CAPTCHA, account-required, and unknown URLs", async () => {
    const fixture = await loadFixture("indeed");
    const adapter = providerModules.indeed.adapter;
    const cases = [
      {
        raw: { ...fixture, applyUrls: [] },
        expected: ["blocked_missing_apply_url", "E", "invalid"],
      },
      {
        raw: { ...fixture, status: "closed" },
        expected: ["blocked_expired", "E", "invalid"],
      },
      {
        raw: {
          ...fixture,
          applyUrls: ["https://careers.example.test/jobs/1"],
          sourceDocument: { signal: "hcaptcha" },
        },
        expected: ["blocked_captcha", "E", "invalid"],
      },
      {
        raw: fixture,
        expected: ["blocked_user_account_required", "D", "invalid"],
      },
      {
        raw: {
          ...fixture,
          applyUrls: ["https://careers.example.test/jobs/1"],
        },
        expected: ["needs_validation", "C", "unknown"],
      },
    ] as const;

    for (const { raw, expected } of cases) {
      const job = toCanonicalJob(adapter.normalizeRaw(raw), fixedNow);
      expect([
        job.applyFulfillmentStatus,
        job.applyabilityTier,
        job.validationStatus,
      ]).toEqual(expected);
    }
  });
});

describe("G004 rate control", () => {
  test("enforces both concurrency and request spacing", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const gate = new ProviderRateGate(
      { requestsPerMinute: 60, concurrency: 1 },
      () => now,
      async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    );
    const signal = new AbortController().signal;

    await gate.run(async () => "first", signal);
    await gate.run(async () => "second", signal);

    expect(sleeps).toEqual([1_000]);
  });
});
