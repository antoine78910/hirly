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
import { createTaskHandlers } from "../apps/worker/src/runtime/handlers";
import { Consumer } from "../apps/worker/src/runtime/consumer";
import { PermanentTaskError } from "../apps/worker/src/runtime/retry";
import type {
  ConsumerRepository,
  RuntimeStore,
} from "../apps/worker/src/runtime/types";
import type {
  CanonicalJob,
  Provider,
  ProviderSearchRequest,
} from "../packages/contracts/src/index";
import type { ClaimedTask, Lease } from "../packages/db/src/index";
import { createJsonLogger } from "../packages/observability/src/index";

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

function claimedProviderTask(provider: Provider = "apec"): ClaimedTask {
  return {
    taskId: "00000000-0000-4000-8000-000000000041",
    runId: "00000000-0000-4000-8000-000000000042",
    taskKey: `g004-${provider}`,
    taskType: "provider.fetch_page",
    provider,
    payload: {
      query: "engineering",
      location: "France",
      countryCode: "FR",
      cursor: null,
      pageSize: 50,
      maxPages: 1,
    },
    leaseToken: "00000000-0000-4000-8000-000000000043",
    claimGeneration: 1n,
    leaseOwner: "g004-test-worker",
    attempts: 1,
    maxAttempts: 3,
    leaseUntil: new Date("2026-07-20T00:01:00.000Z"),
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

  test("changes fingerprints when identity-relevant content changes", async () => {
    const fixture = await loadFixture("hellowork");
    const adapter = providerModules.hellowork.adapter;
    const baseline = toCanonicalJob(adapter.normalizeRaw(fixture), fixedNow);
    const changed = toCanonicalJob(
      adapter.normalizeRaw({
        ...fixture,
        title: "Principal Data Engineer",
      }),
      fixedNow,
    );

    expect(changed.fingerprint).not.toBe(baseline.fingerprint);
  });

  test("redacts secrets and personal data before retaining the source document", async () => {
    const fixture = await loadFixture("apec");
    const sensitive = {
      ...fixture,
      sourceDocument: {
        apiToken: "provider-secret",
        recruiterEmail: "person@example.test",
        nested: {
          authorization: "Bearer abc.def.ghi",
          databaseUrl: "postgres://worker:password@db.example.test/jobs",
        },
      },
    };
    const normalized = providerModules.apec.adapter.normalizeRaw(sensitive);
    const serialized = JSON.stringify(toCanonicalJob(normalized, fixedNow).data);

    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("person@example.test");
    expect(serialized).not.toContain("abc.def.ghi");
    expect(serialized).not.toContain("worker:password");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[REDACTED_EMAIL]");
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

  test("requires approved, sanitized fixture provenance for every provider", async () => {
    for (const provider of providers) {
      const fixture = await loadFixture(provider);
      expect(fixture.provenance).toEqual({
        kind: "synthetic_sanitized",
        approvalRef: ".omx/plans/prd-nextjs-bun-foundation.md#phase-4",
        containsPersonalData: false,
      });
      expect(JSON.stringify(fixture)).not.toMatch(
        /@(?:gmail|outlook|yahoo)\.|Bearer\s|password/i,
      );
    }
  });

  test("accepts optional defaults and rejects malformed input for every provider", async () => {
    for (const provider of providers) {
      const fixture = await loadFixture(provider);
      const core = providerModules[provider] as ProviderCore<Fixture>;
      expect(() =>
        core.adapter.normalizeRaw({
          ...fixture,
          title: "",
        }),
      ).toThrow();

      const optional = { ...fixture } as Partial<Fixture>;
      delete optional.description;
      delete optional.contractType;
      delete optional.status;
      delete optional.applyUrls;
      delete optional.sourceDocument;
      const normalized = core.adapter.normalizeRaw(optional as Fixture);
      expect(normalized.description).toBe("");
      expect(normalized.contractType).toBeNull();
      expect(normalized.status).toBeNull();
      expect(normalized.applyUrls).toEqual([]);
    }
  });

  test("rejects cross-provider fixture payloads", async () => {
    const fixture = await loadFixture("apec");
    expect(() =>
      providerModules.apec.adapter.normalizeRaw({
        ...fixture,
        provider: "indeed",
      }),
    ).toThrow();
  });

  test("paginates and deduplicates fixtures for each provider core", async () => {
    for (const provider of providers) {
      const fixture = await loadFixture(provider);
      const repository = new MemoryRepository();
      const core = providerModules[provider] as ProviderCore<Fixture>;
      const result = await runIngestion({
        provider,
        transport: {
          async fetch(pageRequest) {
            return pageRequest.cursor
              ? { items: [structuredClone(fixture)], nextCursor: null }
              : { items: [fixture], nextCursor: "page-2" };
          },
        },
        adapter: core.adapter,
        repository,
        request: request(provider),
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        now: () => fixedNow,
      });
      expect(result.metrics).toMatchObject({
        pages: 2,
        fetched: 2,
        accepted: 1,
        deduplicated: 1,
        upserted: 1,
      });
      expect(repository.rows.size).toBe(1);
    }
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

  test("fails closed when maxPages is reached before source exhaustion", async () => {
    const fixture = await loadFixture("apec");
    const repository = new MemoryRepository();
    await expect(
      runIngestion({
        provider: "apec",
        transport: {
          async fetch() {
            return { items: [fixture], nextCursor: "still-more" };
          },
        },
        adapter: providerModules.apec.adapter,
        repository,
        request: { ...request("apec"), maxPages: 1 },
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        now: () => fixedNow,
      }),
    ).rejects.toMatchObject({
      code: "provider_permanent",
      message: "provider pagination reached maxPages before exhaustion",
    });
    expect(repository.calls).toBe(0);
    expect(repository.rows.size).toBe(0);
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
          applyUrls: ["https://www.talent.com/view?id=fixture"],
        },
        expected: ["discovery_only", "D", "invalid"],
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

  test("spaces aggregate starts even when concurrency permits overlap", async () => {
    let now = 0;
    const starts: number[] = [];
    const pendingSleeps: Array<{
      wakeAt: number;
      resolve: () => void;
    }> = [];
    const gate = new ProviderRateGate(
      { requestsPerMinute: 60, concurrency: 3 },
      () => now,
      (milliseconds) =>
        new Promise<void>((resolve) => {
          pendingSleeps.push({ wakeAt: now + milliseconds, resolve });
        }),
    );
    const signal = new AbortController().signal;

    const runs = Promise.all(
      Array.from({ length: 3 }, () =>
        gate.run(async () => {
          starts.push(now);
        }, signal),
      ),
    );

    await Bun.sleep(0);
    expect(starts).toEqual([0]);

    const firstSleep = pendingSleeps.shift();
    expect(firstSleep?.wakeAt).toBe(1_000);
    now = firstSleep?.wakeAt ?? now;
    firstSleep?.resolve();
    await Bun.sleep(0);
    expect(starts).toEqual([0, 1_000]);

    const secondSleep = pendingSleeps.shift();
    expect(secondSleep?.wakeAt).toBe(2_000);
    now = secondSleep?.wakeAt ?? now;
    secondSleep?.resolve();
    await runs;
    expect(starts).toEqual([0, 1_000, 2_000]);
  });

  test("caps true in-flight concurrency and removes an aborted waiter", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const gate = new ProviderRateGate(
      { requestsPerMinute: 60_000, concurrency: 2 },
      () => 0,
      async () => {},
    );
    const run = (signal: AbortSignal) =>
      gate.run(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            releases.push(() => {
              active -= 1;
              resolve();
            });
          }),
        signal,
      );
    const first = run(new AbortController().signal);
    const second = run(new AbortController().signal);
    const queuedController = new AbortController();
    let queuedStarted = false;
    const queued = gate.run(async () => {
      queuedStarted = true;
    }, queuedController.signal);

    await Bun.sleep(0);
    expect(maxActive).toBe(2);
    expect(queuedStarted).toBeFalse();
    queuedController.abort(new Error("cancelled"));
    await expect(queued).rejects.toThrow("cancelled");

    releases.splice(0).forEach((release) => release());
    await Promise.all([first, second]);
    expect(queuedStarted).toBeFalse();
    expect(maxActive).toBe(2);
  });
});

describe("G004 Bun runtime dispatch", () => {
  test("dispatches fixture ingestion through the fenced writer and emits stage metrics", async () => {
    const fixture = await loadFixture("apec");
    const task = claimedProviderTask();
    const writes: CanonicalJob[][] = [];
    const store = {
      async assertProviderRunnable() {},
      async claimProviderWork() {
        return {
          claimId: "11111111-1111-4111-8111-111111111111",
          provider: "apec" as const,
          runtime: "typescript" as const,
          ownershipEpoch: 1n,
          expiresAt: task.leaseUntil,
        };
      },
      async heartbeatProviderWork() {
        return true;
      },
      async finishProviderWork() {
        return true;
      },
      async releaseProviderWork() {
        return true;
      },
      async writeJobsAndComplete(_lease, _providerClaim, jobs) {
        writes.push(jobs);
        return true;
      },
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return null;
      },
    } satisfies RuntimeStore;
    const lines: string[] = [];
    const logger = createJsonLogger((line) => lines.push(line));
    const modules = {
      ...providerModules,
      apec: {
        ...providerModules.apec,
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        transport: {
          async fetch() {
            return { items: [fixture], nextCursor: null };
          },
        },
      },
    } as unknown as Record<Provider, ProviderCore<unknown>>;
    const handler = createTaskHandlers(store, logger, modules)[
      "provider.fetch_page"
    ];

    const result = await handler?.(task, new AbortController().signal);

    expect(result).toEqual({ taskCompleted: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(1);
    expect(writes[0]?.[0]?.jobId).toBe(
      stableJobId("apec", fixture.externalId),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "provider.ingestion_batch",
      provider: "apec",
      outcome: "succeeded",
      counts: {
        fetched: 1,
        accepted: 1,
        rejected: 0,
        deduplicated: 0,
        upserted: 1,
      },
    });
  });

  test("blocks registry-refused providers before fetch or canonical write", async () => {
    let fetches = 0;
    let writes = 0;
    const store = {
      async assertProviderRunnable() {
        throw new Error("authorization_blocked");
      },
      async writeJobsAndComplete() {
        writes += 1;
        return true;
      },
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return null;
      },
    } satisfies RuntimeStore;
    const modules = {
      ...providerModules,
      apec: {
        ...providerModules.apec,
        transport: {
          async fetch() {
            fetches += 1;
            return { items: [], nextCursor: null };
          },
        },
      },
    } as unknown as Record<Provider, ProviderCore<unknown>>;
    const handler = createTaskHandlers(store, undefined, modules)[
      "provider.fetch_page"
    ];

    await expect(
      handler?.(claimedProviderTask(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "PermanentTaskError",
      code: "authorization_blocked",
    });
    expect(fetches).toBe(0);
    expect(writes).toBe(0);
  });

  test("turns a lost writer fence into a stable integrity failure", async () => {
    const fixture = await loadFixture("apec");
    const store = {
      async assertProviderRunnable() {},
      async claimProviderWork(_lease) {
        return {
          claimId: "11111111-1111-4111-8111-111111111111",
          provider: "apec" as const,
          runtime: "typescript" as const,
          ownershipEpoch: 1n,
          expiresAt: new Date("2026-07-20T00:05:00.000Z"),
        };
      },
      async heartbeatProviderWork() {
        return true;
      },
      async finishProviderWork() {
        return true;
      },
      async releaseProviderWork() {
        return true;
      },
      async writeJobsAndComplete() {
        return false;
      },
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return null;
      },
    } satisfies RuntimeStore;
    const modules = {
      ...providerModules,
      apec: {
        ...providerModules.apec,
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        transport: {
          async fetch() {
            return { items: [fixture], nextCursor: null };
          },
        },
      },
    } as unknown as Record<Provider, ProviderCore<unknown>>;
    const handler = createTaskHandlers(store, undefined, modules)[
      "provider.fetch_page"
    ];

    await expect(
      handler?.(claimedProviderTask(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "PermanentTaskError",
      code: "integrity_error",
    });
  });

  test("heartbeats a long provider fetch before completing its canonical write", async () => {
    const fixture = await loadFixture("apec");
    const task = claimedProviderTask();
    let heartbeats = 0;
    let writes = 0;
    const store = {
      async assertProviderRunnable() {},
      async claimProviderWork() {
        return {
          claimId: "11111111-1111-4111-8111-111111111111",
          provider: "apec" as const,
          runtime: "typescript" as const,
          ownershipEpoch: 1n,
          expiresAt: task.leaseUntil,
        };
      },
      async heartbeatProviderWork() {
        heartbeats += 1;
        return true;
      },
      async finishProviderWork() {
        return true;
      },
      async releaseProviderWork() {
        return true;
      },
      async writeJobsAndComplete() {
        writes += 1;
        return true;
      },
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return null;
      },
    } satisfies RuntimeStore;
    const modules = {
      ...providerModules,
      apec: {
        ...providerModules.apec,
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        transport: {
          async fetch() {
            await Bun.sleep(20);
            return { items: [fixture], nextCursor: null };
          },
        },
      },
    } as unknown as Record<Provider, ProviderCore<unknown>>;

    const result = await createTaskHandlers(
      store,
      undefined,
      modules,
      { providerClaimHeartbeatMs: 5 },
    )["provider.fetch_page"]?.(task, new AbortController().signal);

    expect(result).toEqual({ taskCompleted: true });
    expect(heartbeats).toBeGreaterThan(0);
    expect(writes).toBe(1);
  });

  test("atomically finishes an empty provider run", async () => {
    const task = claimedProviderTask();
    let finishes = 0;
    let releases = 0;
    const store = {
      async assertProviderRunnable() {},
      async claimProviderWork() {
        return {
          claimId: "11111111-1111-4111-8111-111111111111",
          provider: "apec" as const,
          runtime: "typescript" as const,
          ownershipEpoch: 1n,
          expiresAt: task.leaseUntil,
        };
      },
      async heartbeatProviderWork() {
        return true;
      },
      async finishProviderWork() {
        finishes += 1;
        return true;
      },
      async releaseProviderWork() {
        releases += 1;
        return true;
      },
      async writeJobsAndComplete() {
        throw new Error("empty runs must not call the canonical writer");
      },
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return null;
      },
    } satisfies RuntimeStore;
    const modules = {
      ...providerModules,
      apec: {
        ...providerModules.apec,
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        transport: {
          async fetch() {
            return { items: [], nextCursor: null };
          },
        },
      },
    } as unknown as Record<Provider, ProviderCore<unknown>>;

    const result = await createTaskHandlers(store, undefined, modules)[
      "provider.fetch_page"
    ]?.(task, new AbortController().signal);

    expect(result).toEqual({ taskCompleted: true });
    expect(finishes).toBe(1);
    expect(releases).toBe(0);
  });

  test("releases a provider claim after a fetch error", async () => {
    const task = claimedProviderTask();
    let releases = 0;
    const store = {
      async assertProviderRunnable() {},
      async claimProviderWork() {
        return {
          claimId: "11111111-1111-4111-8111-111111111111",
          provider: "apec" as const,
          runtime: "typescript" as const,
          ownershipEpoch: 1n,
          expiresAt: task.leaseUntil,
        };
      },
      async heartbeatProviderWork() {
        return true;
      },
      async finishProviderWork() {
        return true;
      },
      async releaseProviderWork() {
        releases += 1;
        return true;
      },
      async writeJobsAndComplete() {
        return true;
      },
      async dueSchedules() {
        return [];
      },
      async enqueueDueSchedule() {
        return null;
      },
      async getRun() {
        return null;
      },
    } satisfies RuntimeStore;
    const modules = {
      ...providerModules,
      apec: {
        ...providerModules.apec,
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
        transport: {
          async fetch() {
            throw new Error("provider unavailable");
          },
        },
      },
    } as unknown as Record<Provider, ProviderCore<unknown>>;

    await expect(
      createTaskHandlers(store, undefined, modules)[
        "provider.fetch_page"
      ]?.(task, new AbortController().signal),
    ).rejects.toThrow("provider unavailable");
    expect(releases).toBe(1);
  });

  test("emits schema-validated terminal failure fields through the consumer", async () => {
    const task = claimedProviderTask("wttj");
    const claims = [[task], []] as ClaimedTask[][];
    const finishes: Array<{ outcome: string; errorCode?: string }> = [];
    const repository = {
      async claim() {
        return claims.shift() ?? [];
      },
      async heartbeat() {
        return true;
      },
      async finish(
        _lease: Lease,
        outcome: "succeeded" | "retryable" | "failed" | "cancelled",
        options?: { errorCode?: string },
      ) {
        finishes.push({ outcome, errorCode: options?.errorCode });
        return true;
      },
      async enqueue() {
        return task.runId;
      },
      async ping() {
        return true;
      },
      async close() {},
    } satisfies ConsumerRepository;
    const lines: string[] = [];
    const consumer = new Consumer(
      repository,
      {
        "provider.fetch_page": async () => {
          throw new PermanentTaskError(
            "authorization_blocked",
            "provider disabled",
          );
        },
      },
      createJsonLogger((line) => lines.push(line)),
      {
        concurrency: 1,
        leaseSeconds: 30,
        heartbeatSeconds: 5,
        pollMs: 5,
        instanceId: "g004-test-worker",
        serviceVersion: "test",
        environment: "test",
      },
    );

    consumer.start();
    await Bun.sleep(20);
    await consumer.stop(100);

    expect(finishes).toEqual([
      { outcome: "failed", errorCode: "authorization_blocked" },
    ]);
    const terminal = lines
      .map((line) => JSON.parse(line))
      .find((event) => event.event === "worker.task_terminal");
    expect(terminal).toMatchObject({
      event: "worker.task_terminal",
      provider: "wttj",
      outcome: "failed",
      reasonCode: "authorization_blocked",
    });
  });
});
