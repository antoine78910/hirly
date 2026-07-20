import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260720001000_open_source_policy_evidence.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../backend/db/migrations/20260720001000_open_source_policy_evidence.down.sql",
    import.meta.url,
  ),
  "utf8",
);

const evidenceArtifacts = [
  {
    fileName: "choisir-le-service-public.json",
    sourceKey: "choisir-le-service-public",
  },
  { fileName: "bpce-open-feed.json", sourceKey: "bpce-open-feed" },
  { fileName: "data-gouv-generic.json", sourceKey: "data-gouv-generic" },
];

describe("G012 immutable open-source policy evidence", () => {
  test("records only disabled qualification manifests with complete rights questions", () => {
    for (const { fileName, sourceKey } of evidenceArtifacts) {
      const raw = readFileSync(
        new URL(`../artifacts/job-ingestion/source-policy/${fileName}`, import.meta.url),
        "utf8",
      );
      const artifact = JSON.parse(raw) as {
        productionEligible: boolean;
        qualificationStatus: string;
        unresolvedRights: string[];
        activationConstraints: string[];
      };

      expect(artifact.productionEligible).toBeFalse();
      expect(artifact.qualificationStatus).not.toBe("approved");
      expect(artifact.unresolvedRights).toHaveLength(8);
      expect(artifact.activationConstraints.join(" ")).toMatch(
        /disabled|required|qualification/i,
      );
      const digest = createHash("sha256").update(raw).digest("hex");
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(migration).toContain(`'${sourceKey}'`);
      expect(migration).toContain(`'${digest}'`);
    }
  });

  test("creates append-only evidence without activating a source or writer", () => {
    expect(migration).toContain("public.source_policy_evidence");
    expect(migration).toContain("artifact_sha256 text NOT NULL");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("production_eligible boolean NOT NULL DEFAULT false");
    expect(migration).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:provider_registry|career_sources|source_policy)\b/i,
    );
    expect(rollback).toContain("DROP TABLE IF EXISTS public.source_policy_evidence");
  });
});
