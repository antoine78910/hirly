import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  runIngestion,
  stableJobId,
  type NormalizedProviderJob,
  type ProviderAdapter,
  type ProviderTransport,
} from "../packages/ingestion/src";

function normalizedJob(externalId: string): NormalizedProviderJob {
  return {
    envelope: {
      provider: "apec",
      externalId,
      payload: { externalId, source: "contract-fixture" },
    },
    title: "Ingénieur Logiciel",
    company: "Hirly SAS",
    location: "Paris, France",
    countryCode: "France",
    description: "Build reliable job ingestion.",
    contractType: "CDI",
    status: "active",
    applyUrls: [
      "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/1",
      "https://boards.greenhouse.io/hirly/jobs/1",
    ],
  };
}

describe("G009 source adapter contract", () => {
  test("rejects a provider identity mismatch before transport access", async () => {
    let fetched = false;
    const transport: ProviderTransport<unknown> = {
      async fetch() {
        fetched = true;
        return { items: [], nextCursor: null };
      },
    };
    const adapter: ProviderAdapter<unknown> = {
      provider: "indeed",
      normalizeRaw() {
        return normalizedJob("identity-mismatch");
      },
    };

    await expect(
      runIngestion({
        provider: "apec",
        transport,
        adapter,
        repository: {
          async upsertCanonicalBatch() {
            throw new Error("writer must not run");
          },
        },
        request: {
          provider: "apec",
          query: null,
          location: null,
          countryCode: "FR",
          cursor: null,
          pageSize: 50,
          maxPages: 1,
        },
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      }),
    ).rejects.toMatchObject({ code: "integrity_error" });
    expect(fetched).toBeFalse();
  });

  test("keeps stable IDs and deduplicates repeated source occurrences before one write", async () => {
    const raw = [
      { externalId: "same-source-id" },
      { externalId: "same-source-id" },
    ];
    let writtenIds: string[] = [];

    const result = await runIngestion({
      provider: "apec",
      transport: {
        async fetch() {
          return { items: raw, nextCursor: null };
        },
      },
      adapter: {
        provider: "apec",
        normalizeRaw(item: { externalId: string }) {
          return normalizedJob(item.externalId);
        },
      },
      repository: {
        async upsertCanonicalBatch(jobs) {
          writtenIds = jobs.map(({ jobId }) => jobId);
          return jobs.length;
        },
      },
      request: {
        provider: "apec",
        query: null,
        location: null,
        countryCode: "FR",
        cursor: null,
        pageSize: 50,
        maxPages: 1,
      },
      rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      now: () => new Date("2026-07-20T00:00:00Z"),
    });

    expect(writtenIds).toEqual([stableJobId("apec", "same-source-id")]);
    expect(result.metrics).toMatchObject({
      fetched: 2,
      accepted: 1,
      rejected: 0,
      deduplicated: 1,
      upserted: 1,
      pages: 1,
    });
    expect(result.jobs[0]).toMatchObject({
      countryCode: "FR",
      selectedApplyUrl: "https://boards.greenhouse.io/hirly/jobs/1",
      validationStatus: "valid",
      applyabilityTier: "A",
      applyFulfillmentStatus: "manual_ready",
      manualFulfillmentReady: true,
      autoApplySupported: true,
    });
  });

  test("keeps every existing and future transport disabled by default", () => {
    const providerCore = readFileSync(
      new URL("../apps/worker/src/providers/core.ts", import.meta.url),
      "utf8",
    );
    const providerRegistry = readFileSync(
      new URL(
        "../backend/db/migrations/20260720000100_typescript_worker_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(providerCore).toContain("liveTransportReady: false");
    expect(providerCore).toContain("provider transport is disabled");
    expect(providerRegistry).toContain(
      "false, 'none', '{\"requestsPerMinute\":1,\"concurrency\":1}'",
    );
  });
});
