import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  IngestionError,
  stableJobId,
  toCanonicalJob,
  type SourceContext,
} from "../packages/ingestion/src";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import {
  AtsFixtureHttpError,
  classifyAtsSourceError,
} from "../apps/worker/src/providers/ats-fixture";
import {
  createGreenhouseFixtureSourceAdapter,
  greenhouseProvider,
  greenhouseRawJobSchema,
  type GreenhouseRawJob,
} from "../apps/worker/src/providers/greenhouse";
import {
  createLeverFixtureSourceAdapter,
  leverProvider,
  leverRawJobSchema,
  type LeverRawJob,
} from "../apps/worker/src/providers/lever";
import {
  assertProviderTransportActive,
  getProviderModule,
} from "../apps/worker/src/providers";

const fixturePolicyId = "00000000-0000-4000-8000-000000000011";

interface AtsFixture<RawJob> {
  provenance: {
    kind: "sanitized_official_documentation_example";
    source: string;
    containsPersonalData: false;
  };
  provider: "greenhouse" | "lever";
  tenantKey: string;
  countryCodes: string[];
  raw: RawJob[];
}

async function fixture<RawJob>(
  name: "greenhouse" | "lever",
): Promise<AtsFixture<RawJob>> {
  return JSON.parse(
    await readFile(
      new URL(`./fixtures/g011/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as AtsFixture<RawJob>;
}

function source(
  provider: "greenhouse" | "lever",
  tenantKey: string,
  countryCodes: string[],
): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    provider,
    sourceKey: tenantKey,
    tenantKey,
    countryCodes,
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
  return {
    source: entry,
    runId: "fixture-run",
    fetchedAt: new Date("2026-07-20T00:00:00.000Z"),
  };
}

async function pages<RawJob>(
  adapter: {
    discover(input: {
      source: SourceRegistryEntry;
      mode: "full";
      cursor: null;
      signal: AbortSignal;
    }): AsyncIterable<unknown>;
  },
  entry: SourceRegistryEntry,
) {
  const result = [];
  for await (const page of adapter.discover({
    source: entry,
    mode: "full",
    cursor: null,
    signal: new AbortController().signal,
  })) {
    result.push(page);
  }
  return result;
}

describe("G011 disabled ATS fixture connectors", () => {
  test("keeps every candidate transport and canonical writer disabled", () => {
    for (const provider of [greenhouseProvider, leverProvider]) {
      expect(provider.authorizationStatus).toBe("unverified");
      expect(provider.liveTransportReady).toBe(false);
      expect(provider.canonicalWriteReady).toBe(false);
      expect(provider.shadowModeReady).toBe(false);
      expect(provider.rateLimit).toEqual({
        requestsPerMinute: 1,
        concurrency: 1,
      });
    }
    expect(getProviderModule("greenhouse")).toBe(greenhouseProvider);
    expect(getProviderModule("lever")).toBe(leverProvider);
    expect(() => assertProviderTransportActive("greenhouse")).toThrow(
      "provider transport is inactive: greenhouse",
    );
    expect(() => assertProviderTransportActive("lever")).toThrow(
      "provider transport is inactive: lever",
    );
  });

  test("normalizes Greenhouse identity, provenance and complete checkpoints", async () => {
    const data = await fixture<GreenhouseRawJob>("greenhouse");
    expect(data.provenance).toMatchObject({
      kind: "sanitized_official_documentation_example",
      containsPersonalData: false,
    });
    const rows = data.raw.map((raw) => greenhouseRawJobSchema.parse(raw));
    const entry = source("greenhouse", data.tenantKey, data.countryCodes);
    const adapter = createGreenhouseFixtureSourceAdapter(
      rows,
      fixturePolicyId,
    );
    const result = await pages(adapter, entry);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      complete: false,
      sourceReportedTotal: 2,
      nextCursor: { version: "g011-fixture-v1", offset: 1 },
    });
    expect(result[1]).toMatchObject({
      complete: true,
      sourceReportedTotal: 2,
      nextCursor: null,
    });

    const occurrence = adapter.normalize(rows[0], context(entry));
    expect(occurrence).toMatchObject({
      externalId: "vaulttec:127817",
      canonicalApplyUrl:
        "https://boards.greenhouse.io/vaulttec/jobs/127817",
      atsPostingId: "127817",
      job: {
        countryCode: "US",
        envelope: {
          provider: "greenhouse",
          externalId: "vaulttec:127817",
        },
      },
    });
    const canonical = toCanonicalJob(
      occurrence.job,
      new Date("2026-07-20T00:00:00.000Z"),
    );
    expect(canonical.jobId).toBe(
      stableJobId("greenhouse", "vaulttec:127817"),
    );
    expect(adapter.attribution(rows[0])).toMatchObject({
      policyId: fixturePolicyId,
      licenceName: null,
      attributionText: null,
      sourceUrl: data.provenance.source,
    });
  });

  test("separates Lever hosted source from direct apply URL and restarts from checkpoints", async () => {
    const data = await fixture<LeverRawJob>("lever");
    const rows = data.raw.map((raw) => leverRawJobSchema.parse(raw));
    const entry = source("lever", data.tenantKey, data.countryCodes);
    const adapter = createLeverFixtureSourceAdapter(rows, fixturePolicyId);
    const first = adapter.discover({
      source: entry,
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    });
    const firstPage = await first[Symbol.asyncIterator]().next();
    expect(firstPage.value?.nextCursor).toEqual({
      version: "g011-fixture-v1",
      offset: 1,
    });
    const restarted = adapter.discover({
      source: entry,
      mode: "full",
      cursor: firstPage.value!.nextCursor,
      signal: new AbortController().signal,
    });
    const remaining = [];
    for await (const page of restarted) remaining.push(page);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].items[0].id).toBe("posting-002");
    expect(remaining[0].complete).toBe(true);

    const occurrence = adapter.normalize(rows[0], context(entry));
    expect(occurrence).toMatchObject({
      externalId: "leverdemo:posting-001",
      canonicalSourceUrl:
        "https://jobs.lever.co/leverdemo/posting-001",
      canonicalApplyUrl:
        "https://jobs.lever.co/leverdemo/posting-001/apply",
      atsPostingId: "posting-001",
      job: {
        countryCode: "US",
        applyUrls: [
          "https://jobs.lever.co/leverdemo/posting-001",
          "https://jobs.lever.co/leverdemo/posting-001/apply",
        ],
      },
    });
    expect(adapter.validateActive(rows[0], context(entry).fetchedAt)).toMatchObject({
      state: "active",
      reason: expect.stringContaining("complete successful scope"),
    });
  });

  test("fails closed on invalid checkpoints and classifies provider errors", async () => {
    const data = await fixture<GreenhouseRawJob>("greenhouse");
    const rows = data.raw.map((raw) => greenhouseRawJobSchema.parse(raw));
    const entry = source("greenhouse", data.tenantKey, data.countryCodes);
    const adapter = createGreenhouseFixtureSourceAdapter(
      rows,
      fixturePolicyId,
    );
    const invalid = adapter.discover({
      source: entry,
      mode: "full",
      cursor: { version: "g011-fixture-v1", offset: 99 },
      signal: new AbortController().signal,
    });
    await expect(invalid[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      IngestionError,
    );
    expect(classifyAtsSourceError(new AtsFixtureHttpError(429))).toBe(
      "rate_limited",
    );
    expect(classifyAtsSourceError(new AtsFixtureHttpError(503))).toBe(
      "retryable",
    );
    expect(classifyAtsSourceError(new AtsFixtureHttpError(403))).toBe(
      "authorization",
    );
    expect(classifyAtsSourceError(new SyntaxError("bad fixture"))).toBe(
      "malformed",
    );
  });

  test("records an empty fixture board as an explicit complete scope", async () => {
    const entry = source("greenhouse", "empty-board", ["FR"]);
    const adapter = createGreenhouseFixtureSourceAdapter(
      [],
      fixturePolicyId,
    );
    expect(await pages(adapter, entry)).toEqual([
      {
        scope: {
          sourceId: entry.id,
          tenantKey: "empty-board",
          mode: "full",
        },
        items: [],
        nextCursor: null,
        sourceReportedTotal: 0,
        complete: true,
        requestCount: 1,
        costMinor: 0,
      },
    ]);
  });
});
