import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import {
  IngestionError,
  stableJobId,
  toCanonicalJob,
  type SourceContext,
} from "../packages/ingestion/src";
import {
  DATA_GOUV_FIXTURE_CURSOR_VERSION,
  type DataGouvRawJob,
} from "../packages/ingestion/src/data-gouv";
import {
  BPCE_DATASET_URL,
  BpceFixtureSourceAdapter,
  bpceOpenFeedFixtureSchema,
  createBpceFixtureSourceAdapter,
  type BpceOpenFeedFixture,
} from "../apps/worker/src/providers/bpce";

const fixturePolicyId = "00000000-0000-4000-8000-000000000021";

async function fixture(): Promise<BpceOpenFeedFixture> {
  return bpceOpenFeedFixtureSchema.parse(
    JSON.parse(
      await readFile(new URL("./fixtures/g012/bpce-open-feed.json", import.meta.url), "utf8"),
    ),
  );
}

function source(): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000022",
    provider: "data_gouv",
    sourceKey: "groupe-bpce-offres-emploi-publiques:bpce-resource-fixture-v1",
    tenantKey: "groupe-bpce",
    countryCodes: ["FR"],
    accessType: "open_data",
    policyId: fixturePolicyId,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    checkpoint: { fixturePageSize: 1 },
  };
}

function context(entry = source()): SourceContext {
  return {
    source: entry,
    runId: "bpce-fixture-run",
    fetchedAt: new Date("2026-07-20T00:00:00.000Z"),
  };
}

async function rows(
  adapter: ReturnType<typeof createBpceFixtureSourceAdapter>,
): Promise<DataGouvRawJob[]> {
  const result: DataGouvRawJob[] = [];
  for await (const page of adapter.discover({
    source: source(),
    mode: "full",
    cursor: null,
    signal: new AbortController().signal,
  })) {
    result.push(...page.items);
  }
  return result;
}

describe("G012 BPCE disabled fixture adapter", () => {
  test("is fixture-only, disabled, and policy-ineligible", async () => {
    const adapter = new BpceFixtureSourceAdapter(await fixture(), fixturePolicyId);
    expect(adapter).toMatchObject({
      provider: "data_gouv",
      access: "open_data",
      enabled: false,
      liveTransportReady: false,
      canonicalWriteReady: false,
      sourcePolicyEligible: false,
    });
    await expect(async () => {
      for await (const _page of adapter.discover({
        source: { ...source(), transportEnabled: true },
        mode: "full",
        cursor: null,
        signal: new AbortController().signal,
      })) {
        // Source validation occurs before fixture data is emitted.
      }
    }).toThrow("every mode disabled");
  });

  test("normalizes stable identity, France, direct apply route, and provenance", async () => {
    const adapter = createBpceFixtureSourceAdapter(await fixture(), fixturePolicyId);
    const [raw] = await rows(adapter);
    const first = adapter.normalize(raw, context());
    const repeated = adapter.normalize(raw, context());
    const externalId =
      "groupe-bpce-offres-emploi-publiques:bpce-resource-fixture-v1:bpce-fixture-001";

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      externalId,
      canonicalSourceUrl: BPCE_DATASET_URL,
      canonicalApplyUrl:
        "https://jobs.smartrecruiters.com/BPCESyntheticFixture/000000000000000001-ingenieure-plateforme",
      atsPostingId: null,
      job: {
        countryCode: "FR",
        company: "Groupe BPCE",
        envelope: {
          provider: "data_gouv",
          externalId,
          payload: {
            datasetId: "groupe-bpce-offres-emploi-publiques",
            resourceId: "bpce-resource-fixture-v1",
            recordId: "bpce-fixture-001",
            sourceDocument: {
              reference: "bpce-fixture-001",
              employeur: "Groupe BPCE",
              pays: "France",
            },
          },
        },
      },
    });

    const canonical = toCanonicalJob(first.job, context().fetchedAt);
    expect(canonical).toMatchObject({
      jobId: stableJobId("data_gouv", externalId),
      provider: "data_gouv",
      externalId,
      countryCode: "FR",
      selectedApplyUrl:
        "https://jobs.smartrecruiters.com/BPCESyntheticFixture/000000000000000001-ingenieure-plateforme",
      validationStatus: "valid",
      atsProvider: "smartrecruiters",
      applyabilityTier: "A",
      autoApplySupported: true,
      applyFulfillmentStatus: "manual_ready",
      manualFulfillmentReady: true,
    });
  });

  test("uses repeatable digest checkpoints and complete resource scopes", async () => {
    const adapter = createBpceFixtureSourceAdapter(await fixture(), fixturePolicyId);
    const firstIterator = adapter
      .discover({
        source: source(),
        mode: "full",
        cursor: null,
        signal: new AbortController().signal,
      })
      [Symbol.asyncIterator]();
    const first = await firstIterator.next();
    expect(first.value).toMatchObject({
      complete: false,
      sourceReportedTotal: 2,
      requestCount: 0,
      nextCursor: {
        version: DATA_GOUV_FIXTURE_CURSOR_VERSION,
        offset: 1,
      },
      scope: {
        datasetId: "groupe-bpce-offres-emploi-publiques",
        resourceId: "bpce-resource-fixture-v1",
        mode: "full",
      },
    });

    const replayed = [];
    for await (const page of adapter.discover({
      source: source(),
      mode: "full",
      cursor: first.value?.nextCursor,
      signal: new AbortController().signal,
    })) {
      replayed.push(page);
    }
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      complete: true,
      nextCursor: null,
      items: [{ recordId: "bpce-fixture-002" }],
    });
  });

  test("exposes attribution and conservative lifecycle evidence", async () => {
    const adapter = createBpceFixtureSourceAdapter(await fixture(), fixturePolicyId);
    const discovered = await rows(adapter);
    expect(adapter.attribution(discovered[0])).toEqual({
      policyId: fixturePolicyId,
      licenceName: "Licence Ouverte 2.0",
      attributionText:
        "Groupe BPCE — data.gouv.fr; production attribution wording remains subject to source-specific legal review.",
      sourceUrl: BPCE_DATASET_URL,
    });
    expect(adapter.validateActive(discovered[0], context().fetchedAt)).toMatchObject({
      state: "active",
      reason: expect.stringContaining("complete successful resource scope"),
    });
    expect(adapter.validateActive(discovered[1], context().fetchedAt)).toMatchObject({
      state: "expired",
      reason: expect.stringContaining("explicit"),
    });
    expect(adapter.validateActive(discovered[0], context().fetchedAt).state).not.toBe("removed");
  });

  test("rejects malformed URLs and source identity collisions", async () => {
    const data = await fixture();
    for (const unsafeUrl of [
      "http://example.test/apply",
      "https://user:pass@example.test/apply",
      "ftp://example.test/apply",
    ]) {
      expect(() =>
        bpceOpenFeedFixtureSchema.parse({
          ...data,
          raw: [
            {
              ...data.raw[0],
              urlCandidature: unsafeUrl,
            },
          ],
        }),
      ).toThrow(/BPCE fixture URLs/);
    }
    expect(
      () =>
        new BpceFixtureSourceAdapter(
          {
            ...data,
            raw: [{ ...data.raw[0], reference: "collision:value" }],
          },
          fixturePolicyId,
        ),
    ).toThrow(IngestionError);
    const adapter = createBpceFixtureSourceAdapter(data, fixturePolicyId);
    expect(() =>
      adapter.normalize(
        {
          datasetId: "other-dataset",
          resourceId: "other-resource",
          recordId: "other-record",
          title: "Other",
          employer: "Other",
          location: "Paris",
          countryCode: "FR",
          description: "",
          contractType: null,
          status: "active",
          applyUrls: ["https://apply.example.org/other"],
          sourceUrl: "https://www.data.gouv.fr/",
          publishedAt: null,
          expiresAt: null,
          sourceDocument: {},
        },
        context(),
      ),
    ).toThrow("does not match the bound dataset resource");
  });
});
