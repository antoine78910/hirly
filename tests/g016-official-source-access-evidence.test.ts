import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

type SourceEvidence = {
  sourceKey: string;
  decision: string;
  evidenceOnlyTransportEligible: boolean;
  productionEligible: boolean;
  blockers: string[];
  officialEvidence: Array<{ kind: string; url: string }>;
  sampleManifest?: {
    contentSha256: string;
    byteLength: number;
    parsedRows: number;
    resourceId: string;
    resourceUrl: string;
  };
};

const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../artifacts/job-ingestion/source-policy/g016-official-access-2026-07-20.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  classification: string;
  scope: string;
  productionEligible: boolean;
  canonicalWritesAllowed: boolean;
  sources: SourceEvidence[];
};

describe("G016 official source access evidence", () => {
  test("qualifies only the two exact open-data candidates for evidence-only transport", () => {
    expect(manifest.classification).toBe("TS_NEW");
    expect(manifest.scope).toBe("evidence_only");
    expect(manifest.productionEligible).toBeFalse();
    expect(manifest.canonicalWritesAllowed).toBeFalse();

    const eligible = manifest.sources
      .filter((source) => source.evidenceOnlyTransportEligible)
      .map((source) => source.sourceKey)
      .sort();
    expect(eligible).toEqual(["bpce-open-feed", "choisir-le-service-public"]);

    for (const source of manifest.sources) {
      expect(source.productionEligible).toBeFalse();
      expect(source.blockers.length).toBeGreaterThan(0);
      expect(source.officialEvidence.length).toBeGreaterThan(0);
      expect(
        source.officialEvidence.every(({ url }) => url.startsWith("https://")),
      ).toBeTrue();
    }
  });

  test("binds approved samples to exact resource identifiers and content digests", () => {
    const approved = manifest.sources.filter(
      (source) => source.decision === "qualified_evidence_only",
    );
    expect(approved).toHaveLength(2);

    for (const source of approved) {
      expect(source.sampleManifest).toBeDefined();
      expect(source.sampleManifest?.resourceId).not.toBeEmpty();
      expect(source.sampleManifest?.resourceUrl).toStartWith("https://");
      expect(source.sampleManifest?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.sampleManifest?.byteLength).toBeGreaterThan(0);
      expect(source.sampleManifest?.parsedRows).toBeGreaterThan(0);
    }
  });

  test("keeps every source without written commercial rights contract-gated", () => {
    const contractGated = ["apec", "la-bonne-alternance", "smartrecruiters", "taleez"];
    for (const sourceKey of contractGated) {
      const source = manifest.sources.find((candidate) => candidate.sourceKey === sourceKey);
      expect(source?.decision).toBe("provider_contract_missing");
      expect(source?.evidenceOnlyTransportEligible).toBeFalse();
    }

    const generic = manifest.sources.find(
      (source) => source.sourceKey === "data-gouv-generic",
    );
    expect(generic?.decision).toBe("dataset_specific_evidence_required");
    expect(generic?.evidenceOnlyTransportEligible).toBeFalse();
  });
});
