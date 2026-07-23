import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import { stableJobId, toCanonicalJob, type SourceContext } from "../packages/ingestion/src";
import {
  CSP_DATASET_ID,
  CSP_DATASET_URL,
  CSP_QUALIFICATION_RESOURCE_ID,
  createCspFixtureSourceAdapter,
  cspRawJobSchema,
  type CspRawJob,
} from "../apps/worker/src/providers/csp";

const fixturePolicyId = "00000000-0000-4000-8000-000000000021";
const fixedNow = new Date("2026-07-20T00:00:00.000Z");

interface CspFixture {
  provenance: {
    kind: "synthetic_sanitized_qualification_fixture";
    source: string;
    containsPersonalData: false;
    productionEligible: false;
  };
  datasetId: typeof CSP_DATASET_ID;
  resourceId: typeof CSP_QUALIFICATION_RESOURCE_ID;
  initialSnapshot: CspRawJob[];
  afterRemovalSnapshot: CspRawJob[];
}

async function fixture(): Promise<CspFixture> {
  return JSON.parse(
    await readFile(new URL("./fixtures/g012/csp.json", import.meta.url), "utf8"),
  ) as CspFixture;
}

function source(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000022",
    provider: "data_gouv",
    sourceKey: `${CSP_DATASET_ID}:${CSP_QUALIFICATION_RESOURCE_ID}`,
    tenantKey: null,
    countryCodes: ["FR"],
    accessType: "open_data",
    policyId: fixturePolicyId,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    checkpoint: { fixturePageSize: 1 },
    ...overrides,
  };
}

function context(entry = source()): SourceContext {
  return {
    source: entry,
    runId: "csp-fixture-run",
    fetchedAt: fixedNow,
  };
}

describe("G012 disabled CSP fixture adapter", () => {
  test("stays fixture-only and policy-ineligible with explicit attribution", async () => {
    const data = await fixture();
    const rows = data.initialSnapshot.map((row) => cspRawJobSchema.parse(row));
    const adapter = createCspFixtureSourceAdapter(rows, fixturePolicyId);

    expect(data.provenance).toMatchObject({
      kind: "synthetic_sanitized_qualification_fixture",
      source: CSP_DATASET_URL,
      containsPersonalData: false,
      productionEligible: false,
    });
    expect(adapter).toMatchObject({
      provider: "data_gouv",
      access: "open_data",
      enabled: false,
      liveTransportReady: false,
      canonicalWriteReady: false,
      sourcePolicyEligible: false,
    });
    expect(adapter.attribution(rows[0])).toEqual({
      policyId: fixturePolicyId,
      licenceName: "Licence Ouverte 2.0",
      attributionText:
        "Choisir le Service Public — fixture de qualification; attribution de production soumise à l’approbation de la ressource exacte.",
      sourceUrl: CSP_DATASET_URL,
    });

    await expect(async () => {
      for await (const _page of adapter.discover({
        source: source({ enabled: true }),
        mode: "full",
        cursor: null,
        signal: new AbortController().signal,
      })) {
        // Source validation happens before a page is emitted.
      }
    }).toThrow("every mode disabled");
  });

  test("normalizes stable identity, France, direct apply URL and fulfillment", async () => {
    const data = await fixture();
    const row = cspRawJobSchema.parse(data.initialSnapshot[0]);
    const adapter = createCspFixtureSourceAdapter([row], fixturePolicyId);
    const first = adapter.normalize(row, context());
    const second = adapter.normalize(structuredClone(row), context());
    const externalId = `${CSP_DATASET_ID}:${CSP_QUALIFICATION_RESOURCE_ID}:csp-fixture-001`;

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      externalId,
      canonicalSourceUrl: CSP_DATASET_URL,
      canonicalApplyUrl: "https://boards.greenhouse.io/administrationexemple/jobs/csp-fixture-001",
      atsPostingId: null,
      job: {
        countryCode: "FR",
        envelope: {
          provider: "data_gouv",
          externalId,
          payload: {
            datasetId: CSP_DATASET_ID,
            resourceId: CSP_QUALIFICATION_RESOURCE_ID,
            recordId: "csp-fixture-001",
            sourceDocument: {
              reference: "csp-fixture-001",
              qualification_fixture: true,
            },
          },
        },
      },
    });

    const canonical = toCanonicalJob(first.job, fixedNow);
    expect(canonical.jobId).toBe(stableJobId("data_gouv", externalId));
    expect(canonical).toMatchObject({
      countryCode: "FR",
      selectedApplyUrl: "https://boards.greenhouse.io/administrationexemple/jobs/csp-fixture-001",
      validationStatus: "valid",
      applyabilityTier: "A",
      applyFulfillmentStatus: "manual_ready",
      manualFulfillmentReady: true,
      autoApplySupported: true,
      atsProvider: "greenhouse",
    });
  });

  test("uses complete immutable snapshots for lifecycle and removal evidence", async () => {
    const data = await fixture();
    const initialRows = data.initialSnapshot.map((row) => cspRawJobSchema.parse(row));
    const initial = createCspFixtureSourceAdapter(initialRows, fixturePolicyId);
    const pages = [];
    for await (const page of initial.discover({
      source: source(),
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      complete: false,
      sourceReportedTotal: 2,
      scope: {
        datasetId: CSP_DATASET_ID,
        resourceId: CSP_QUALIFICATION_RESOURCE_ID,
        mode: "full",
      },
    });
    expect(pages[1]).toMatchObject({
      complete: true,
      sourceReportedTotal: 2,
      nextCursor: null,
    });
    expect(initial.validateActive(initialRows[0], fixedNow)).toMatchObject({
      state: "active",
      reason: expect.stringContaining("complete successful resource scope"),
    });
    expect(initial.validateActive(initialRows[1], fixedNow)).toMatchObject({
      state: "expired",
      reason: expect.stringContaining("explicit"),
    });

    const afterRemoval = createCspFixtureSourceAdapter(data.afterRemovalSnapshot, fixturePolicyId);
    const remaining = [];
    for await (const page of afterRemoval.discover({
      source: source(),
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    })) {
      remaining.push(...page.items);
      expect(page.complete).toBeTrue();
    }
    expect(remaining.map((row) => row.recordId)).toEqual(["csp-fixture-001"]);
  });

  test("rejects source-specific identity drift before generic ingestion", async () => {
    const data = await fixture();
    const row = data.initialSnapshot[0];
    expect(() =>
      cspRawJobSchema.parse({
        ...row,
        resourceId: "unapproved-live-resource",
      }),
    ).toThrow();
    expect(() =>
      createCspFixtureSourceAdapter([{ ...row, applyUrls: [] }], fixturePolicyId),
    ).toThrow();
    expect(() =>
      createCspFixtureSourceAdapter([{ ...row, countryCode: "BE" }], fixturePolicyId),
    ).toThrow();
    expect(row.sourceUrl).toBe(CSP_DATASET_URL);
  });

  test("rejects unsafe apply URL schemes and embedded credentials", async () => {
    const data = await fixture();
    const row = data.initialSnapshot[0];
    for (const unsafeUrl of [
      "http://boards.greenhouse.io/administrationexemple/jobs/csp-fixture-001",
      "https://user:pass@boards.greenhouse.io/administrationexemple/jobs/csp-fixture-001",
      "ftp://boards.greenhouse.io/administrationexemple/jobs/csp-fixture-001",
    ]) {
      expect(() =>
        cspRawJobSchema.parse({
          ...row,
          applyUrls: [unsafeUrl],
        }),
      ).toThrow(/CSP fixture apply URLs/);
    }
  });
});
