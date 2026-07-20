import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import {
  stableJobId,
  toCanonicalJob,
  type SourceContext,
} from "../packages/ingestion/src";
import {
  DATA_GOUV_FIXTURE_CURSOR_VERSION,
  DataGouvFixtureHttpError,
  FixtureOnlyDataGouvSourceAdapter,
  classifyDataGouvSourceError,
  stableDataGouvExternalId,
  type DataGouvRawJob,
} from "../packages/ingestion/src/data-gouv";
import {
  assertProviderTransportActive,
  dataGouvProvider,
  getProviderModule,
} from "../apps/worker/src/providers";

const fixturePolicyId = "00000000-0000-4000-8000-000000000012";

async function fixture(): Promise<{ raw: DataGouvRawJob[] }> {
  return JSON.parse(
    await readFile(
      new URL("./fixtures/g012/data-gouv-resource.json", import.meta.url),
      "utf8",
    ),
  ) as { raw: DataGouvRawJob[] };
}

function source(): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000013",
    provider: "data_gouv",
    sourceKey: "dataset-fixture:resource-fixture",
    tenantKey: null,
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

function context(entry: SourceRegistryEntry): SourceContext {
  return {
    source: entry,
    runId: "fixture-run",
    fetchedAt: new Date("2026-07-20T00:00:00.000Z"),
  };
}

function adapter(rows: DataGouvRawJob[]) {
  return new FixtureOnlyDataGouvSourceAdapter(rows, {
    policyId: fixturePolicyId,
    licenceName: null,
    attributionText: null,
    sourceUrl: "https://www.data.gouv.fr/",
  });
}

describe("G012 generic data.gouv fixture boundary", () => {
  test("keeps live transport, source policy, and canonical writes disabled", () => {
    expect(dataGouvProvider.authorizationStatus).toBe("unverified");
    expect(dataGouvProvider.liveTransportReady).toBeFalse();
    expect(dataGouvProvider.shadowModeReady).toBeFalse();
    expect(dataGouvProvider.canonicalWriteReady).toBeFalse();
    expect(getProviderModule("data_gouv")).toBe(dataGouvProvider);
    expect(() => assertProviderTransportActive("data_gouv")).toThrow(
      "provider transport is inactive: data_gouv",
    );
  });

  test("derives stable provider identity and preserves raw provenance", async () => {
    const data = await fixture();
    const entry = source();
    const occurrence = adapter(data.raw).normalize(
      data.raw[0],
      context(entry),
    );
    const externalId = "dataset-fixture:resource-fixture:record-001";

    expect(
      stableDataGouvExternalId(
        "dataset-fixture",
        "resource-fixture",
        "record-001",
      ),
    ).toBe(externalId);
    expect(occurrence).toMatchObject({
      externalId,
      canonicalSourceUrl:
        "https://www.data.gouv.fr/fr/datasets/dataset-fixture/",
      canonicalApplyUrl:
        "https://apply.example.org/jobs/record-001",
      atsPostingId: null,
      job: {
        countryCode: "FR",
        envelope: {
          provider: "data_gouv",
          externalId,
          payload: {
            datasetId: "dataset-fixture",
            resourceId: "resource-fixture",
            recordId: "record-001",
            sourceDocument: {
              record_id: "record-001",
              title: "Ingénieure plateforme",
              apply_url:
                "https://apply.example.org/jobs/record-001",
            },
          },
        },
      },
    });
    const canonical = toCanonicalJob(
      occurrence.job,
      context(entry).fetchedAt,
    );
    expect(canonical.jobId).toBe(stableJobId("data_gouv", externalId));
    expect(canonical).toMatchObject({
      selectedApplyUrl:
        "https://apply.example.org/jobs/record-001",
      validationStatus: "unknown",
      applyabilityTier: "C",
      applyFulfillmentStatus: "needs_validation",
      manualFulfillmentReady: true,
    });
  });

  test("uses digest-bound checkpoints and complete resource scopes", async () => {
    const data = await fixture();
    const sourceAdapter = adapter(data.raw);
    const firstIterator = sourceAdapter.discover({
      source: source(),
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();
    const first = await firstIterator.next();

    expect(first.value).toMatchObject({
      sourceReportedTotal: 2,
      complete: false,
      requestCount: 0,
      costMinor: 0,
      nextCursor: {
        version: DATA_GOUV_FIXTURE_CURSOR_VERSION,
        offset: 1,
      },
      scope: {
        datasetId: "dataset-fixture",
        resourceId: "resource-fixture",
        mode: "full",
      },
    });
    const remaining = [];
    for await (const page of sourceAdapter.discover({
      source: source(),
      mode: "full",
      cursor: first.value!.nextCursor,
      signal: new AbortController().signal,
    })) {
      remaining.push(page);
    }
    expect(remaining).toHaveLength(1);
    expect(remaining[0].complete).toBeTrue();
    expect(remaining[0].items[0].recordId).toBe("record-002");

    await expect(async () => {
      for await (const _page of sourceAdapter.discover({
        source: source(),
        mode: "full",
        cursor: {
          ...first.value!.nextCursor!,
          snapshotDigest: "0".repeat(64),
        },
        signal: new AbortController().signal,
      })) {
        // Checkpoint validation happens before a page is emitted.
      }
    }).toThrow("invalid or stale data.gouv fixture checkpoint");

    const changedRows = structuredClone(data.raw);
    changedRows[0]!.title = "Changed outside sourceDocument";
    const changedAdapter = adapter(changedRows);
    await expect(async () => {
      for await (const _page of changedAdapter.discover({
        source: source(),
        mode: "full",
        cursor: first.value!.nextCursor,
        signal: new AbortController().signal,
      })) {
        // A complete-row change must invalidate the old snapshot cursor.
      }
    }).toThrow("invalid or stale data.gouv fixture checkpoint");
  });

  test("classifies lifecycle and retry states without removal on failure", async () => {
    const data = await fixture();
    const sourceAdapter = adapter(data.raw);
    const now = context(source()).fetchedAt;
    expect(sourceAdapter.validateActive(data.raw[0], now)).toMatchObject({
      state: "active",
      reason: expect.stringContaining("complete successful resource scope"),
    });
    expect(sourceAdapter.validateActive(data.raw[1], now)).toMatchObject({
      state: "expired",
      reason: expect.stringContaining("explicit"),
    });
    expect(
      classifyDataGouvSourceError(new DataGouvFixtureHttpError(429)),
    ).toBe("rate_limited");
    expect(
      classifyDataGouvSourceError(new DataGouvFixtureHttpError(503)),
    ).toBe("retryable");
    expect(
      classifyDataGouvSourceError(new DataGouvFixtureHttpError(403)),
    ).toBe("authorization");
    expect(classifyDataGouvSourceError(new SyntaxError("bad fixture"))).toBe(
      "malformed",
    );
  });

  test("rejects identity collisions and enabled source configurations", async () => {
    expect(() =>
      stableDataGouvExternalId("dataset:collision", "resource", "record"),
    ).toThrow("colon-free stable identifier");
    const data = await fixture();
    const sourceAdapter = adapter(data.raw);
    await expect(async () => {
      for await (const _page of sourceAdapter.discover({
        source: { ...source(), enabled: true },
        mode: "full",
        cursor: null,
        signal: new AbortController().signal,
      })) {
        // Source validation happens before a page is emitted.
      }
    }).toThrow("every mode disabled");
    await expect(async () => {
      for await (const _page of sourceAdapter.discover({
        source: {
          ...source(),
          sourceKey: "other-dataset:other-resource",
        },
        mode: "full",
        cursor: null,
        signal: new AbortController().signal,
      })) {
        // Source/resource binding is checked before page emission.
      }
    }).toThrow("match the bound resource and policy");
    await expect(async () => {
      for await (const _page of sourceAdapter.discover({
        source: {
          ...source(),
          policyId: "00000000-0000-4000-8000-000000000099",
        },
        mode: "full",
        cursor: null,
        signal: new AbortController().signal,
      })) {
        // Policy binding is checked before page emission.
      }
    }).toThrow("match the bound resource and policy");
    expect(() =>
      sourceAdapter.normalize(
        {
          ...data.raw[0]!,
          resourceId: "other-resource",
        },
        context(source()),
      ),
    ).toThrow("does not match the bound dataset resource");
  });

  test("rejects unsafe generic fixture source and apply URLs", async () => {
    const data = await fixture();
    for (const unsafeUrl of [
      "http://apply.example.org/jobs/record-001",
      "https://user:pass@apply.example.org/jobs/record-001",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        adapter([
          {
            ...data.raw[0]!,
            applyUrls: [unsafeUrl],
          },
        ]),
      ).toThrow("data.gouv apply URL");
    }
    expect(() =>
      adapter([
        {
          ...data.raw[0]!,
          sourceUrl: "http://www.data.gouv.fr/datasets/dataset-fixture",
        },
      ]),
    ).toThrow("data.gouv source URL must use HTTPS");
  });
});
