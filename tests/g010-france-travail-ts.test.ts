import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { franceTravailProvider } from "../apps/worker/src/providers/france-travail";
import {
  parseContentRange,
  runFranceTravailLiveCensus,
  type FranceTravailCensusManifest,
} from "../apps/job-ingestion-audit/src/france-travail-census";
import { freezeFranceTravailCensusManifest } from "../apps/job-ingestion-audit/src/audit";
import {
  stableJobId,
  toCanonicalJob,
} from "../packages/ingestion/src";

const manifest: FranceTravailCensusManifest = freezeFranceTravailCensusManifest({
  schemaVersion: 1,
  manifestVersion: "fixture-v1",
  paidCohortSnapshotAt: "2026-07-20T00:00:00.000Z",
  paidCohortSnapshotHash: "b".repeat(64),
  profileStrata: [],
  samplingSeed: "fixture",
  publicationWindowRules: { boundary: "half-open", timezone: "UTC" },
  generatedAt: "2026-07-20T00:00:00.000Z",
  capRules: { pageSize: 2, maxRecordsPerPartition: 4, maxRetries: 1 },
  partitions: [{
    id: "fr-01",
    parameters: { department: "01" },
    publishedAfter: "2026-07-01",
    publishedBefore: "2026-07-20",
  }],
});

describe("France Travail TS migration boundary", () => {
  test("matches the frozen Python parity fixture for identity and fulfillment-critical fields", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("./fixtures/g010/france-travail.json", import.meta.url),
        "utf8",
      ),
    ) as {
      raw: unknown;
      expected: Record<string, unknown> & {
        provider: "france_travail";
        externalId: string;
      };
    };
    const job = toCanonicalJob(
      franceTravailProvider.adapter.normalizeRaw(fixture.raw),
      new Date("2026-07-20T00:00:00.000Z"),
    );

    expect(job).toMatchObject({
      ...fixture.expected,
      jobId: stableJobId(
        fixture.expected.provider,
        fixture.expected.externalId,
      ),
    });
  });

  test("normalizes stable identity, FR country and deterministic apply fallback", () => {
    const normalized = franceTravailProvider.adapter.normalizeRaw({
      id: "abc-1", intitule: "Développeur", description: "desc",
      entreprise: {}, lieuTravail: {}, contact: {}, origineOffre: {},
    });
    expect(normalized.envelope.provider).toBe("france_travail");
    expect(normalized.envelope.externalId).toBe("abc-1");
    expect(normalized.countryCode).toBe("FR");
    expect(normalized.applyUrls).toEqual([
      "https://candidat.francetravail.fr/offres/recherche/detail/abc-1",
    ]);
    expect(normalized.contractType).toBeNull();
    expect(normalized.status).toBeNull();
  });

  test("reconciles paginated source totals without duplicates", async () => {
    const calls: string[] = [];
    const result = await runFranceTravailLiveCensus(manifest, {
      accessToken: "fixture-token",
      endpoint: "https://fixture.invalid/search",
      fetcher: async (request) => {
        const url = new URL(request instanceof Request ? request.url : String(request));
        calls.push(url.searchParams.get("range") ?? "");
        const start = Number((url.searchParams.get("range") ?? "0").split("-")[0]);
        const rows = start === 0
          ? [{ id: "1" }, { id: "2" }]
          : [{ id: "2" }, { id: "3" }];
        return new Response(JSON.stringify({ resultats: rows }), {
          status: 206,
          headers: { "content-range": "0-3/3" },
        });
      },
    });
    expect(calls).toEqual(["0-1", "2-3"]);
    expect(result.partitions[0]).toMatchObject({
      status: "complete", sourceReportedTotal: 3,
      uniqueExternalIds: ["1", "2", "3"], duplicateRawRecords: 1,
    });
  });

  test("fails closed on incomplete zero/partial collapse and keeps shadow read-only", () => {
    expect(parseContentRange("items 0-1/9")).toBe(9);
    expect(franceTravailProvider.liveTransportReady).toBe(false);
    expect(franceTravailProvider.canonicalWriteReady).toBe(false);
    expect(franceTravailProvider.shadowModeReady).toBe(true);
  });
});
