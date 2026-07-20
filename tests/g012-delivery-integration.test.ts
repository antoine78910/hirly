import { readFile, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import {
  stableJobId,
  toCanonicalJob,
  type SourceContext,
} from "../packages/ingestion/src";
import {
  dataGouvProductionBlockReason,
  qualifyDataGouvDataset,
} from "../packages/ingestion/src/data-gouv-qualification";
import {
  CSP_DATASET_ID,
  CSP_QUALIFICATION_RESOURCE_ID,
  createCspFixtureSourceAdapter,
  type CspRawJob,
} from "../apps/worker/src/providers/csp";
import {
  bpceOpenFeedFixtureSchema,
  createBpceFixtureSourceAdapter,
} from "../apps/worker/src/providers/bpce";

const policyId = "00000000-0000-4000-8000-000000000031";
const now = new Date("2026-07-20T00:00:00.000Z");

function source(
  datasetId: string,
  resourceId: string,
): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000032",
    provider: "data_gouv",
    sourceKey: `${datasetId}:${resourceId}`,
    tenantKey: null,
    countryCodes: ["FR"],
    accessType: "open_data",
    policyId,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    checkpoint: {},
  };
}

function context(entry: SourceRegistryEntry): SourceContext {
  return { source: entry, runId: "g012-integration", fetchedAt: now };
}

describe("G012 composed delivery", () => {
  test("composes CSP and BPCE through one disabled provider without identity collisions or writes", async () => {
    const cspFixture = JSON.parse(
      await readFile(
        new URL("./fixtures/g012/csp.json", import.meta.url),
        "utf8",
      ),
    ) as { initialSnapshot: CspRawJob[] };
    const bpceFixture = bpceOpenFeedFixtureSchema.parse(
      JSON.parse(
        await readFile(
          new URL("./fixtures/g012/bpce-open-feed.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const cspSource = source(
      CSP_DATASET_ID,
      CSP_QUALIFICATION_RESOURCE_ID,
    );
    const bpceSource = source(
      bpceFixture.datasetId,
      bpceFixture.resourceId,
    );
    const csp = createCspFixtureSourceAdapter(
      cspFixture.initialSnapshot,
      policyId,
    );
    const bpce = createBpceFixtureSourceAdapter(bpceFixture, policyId);

    expect(csp).toMatchObject({
      provider: "data_gouv",
      enabled: false,
      liveTransportReady: false,
      canonicalWriteReady: false,
      sourcePolicyEligible: false,
    });
    expect(bpce).toMatchObject({
      provider: "data_gouv",
      enabled: false,
      liveTransportReady: false,
      canonicalWriteReady: false,
      sourcePolicyEligible: false,
    });

    const cspOccurrence = csp.normalize(
      cspFixture.initialSnapshot[0]!,
      context(cspSource),
    );
    const bpcePages = [];
    for await (const page of bpce.discover({
      source: bpceSource,
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    })) {
      bpcePages.push(...page.items);
    }
    const bpceOccurrence = bpce.normalize(
      bpcePages[0]!,
      context(bpceSource),
    );
    const canonicalJobs = [
      toCanonicalJob(cspOccurrence.job, now),
      toCanonicalJob(bpceOccurrence.job, now),
    ];

    expect(new Set(canonicalJobs.map((job) => job.jobId)).size).toBe(2);
    for (const job of canonicalJobs) {
      expect(job.provider).toBe("data_gouv");
      expect(job.jobId).toBe(stableJobId(job.provider, job.externalId));
      expect(job.countryCode).toBe("FR");
    }
    expect(() =>
      csp.normalize(
        cspFixture.initialSnapshot[0]!,
        context(bpceSource),
      ),
    ).toThrow("match the bound resource and policy");
  });

  test("keeps repository evidence and qualification separate from production enablement", () => {
    const evidence = [
      "choisir-le-service-public.json",
      "bpce-open-feed.json",
      "data-gouv-generic.json",
    ].map((fileName) =>
      JSON.parse(
        readFileSync(
          new URL(
            `../artifacts/job-ingestion/source-policy/${fileName}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ) as Array<{
      qualificationStatus: string;
      productionEligible: boolean;
    }>;
    expect(evidence.every((item) => !item.productionEligible)).toBeTrue();
    expect(
      evidence.every((item) => item.qualificationStatus !== "approved"),
    ).toBeTrue();

    const qualification = qualifyDataGouvDataset({
      datasetId: "dataset",
      resourceId: "resource",
      discovery: { keywordOnly: true, evidenceRef: "catalogue-only" },
      freshness: {
        resourceUpdatedAt: now.toISOString(),
        evaluatedAt: now.toISOString(),
        maximumAgeDays: 1,
        evidenceRef: "fixture",
      },
      licence: {
        name: "",
        evidenceRef: "",
        commercialUseAllowed: false,
        redisplayAllowed: false,
        fullTextRetentionAllowed: false,
        attributionText: "",
      },
      identity: {
        externalIdField: "",
        stableAcrossSnapshots: false,
        evidenceRef: "",
      },
      employer: { field: "", verified: false, evidenceRef: "" },
      applyRoute: {
        field: "",
        canonicalRoutesVerified: false,
        evidenceRef: "",
      },
      relevance: {
        reviewedRows: 0,
        jobRows: 0,
        actionableRows: 0,
        evidenceRef: "",
      },
      lifecycle: {
        updateCadence: "",
        removalSemantics: "",
        evidenceRef: "",
      },
    });
    expect(qualification.decision).toBe("rejected");
    expect(
      dataGouvProductionBlockReason(
        qualification,
        {
          providerEnabled: false,
          providerAuthorizationStatus: "unverified",
          writerRuntime: "none",
          providerCountryKillSwitches: {},
          sourceCountryKillSwitches: {},
          source: source("dataset", "resource"),
          policy: {
            approvalStatus: "unverified",
            enabled: false,
            commercialUseAllowed: false,
            redisplayAllowed: false,
            fullTextRetentionAllowed: false,
            enabledEnvironments: ["test"],
            permittedAccessMethods: ["open_data"],
            expiresAt: null,
          },
        },
        "FR",
        "incremental",
        now,
      ),
    ).toBe("qualification_rejected");
  });
});
