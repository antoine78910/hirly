import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  finalizeSourcePolicyResult,
  persistSourcePolicyResult,
  verifyPersistedSourcePolicyResult,
} from "../src/source-policy-result";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function evidenceResult() {
  return {
    schemaVersion: "source-policy-result.v1",
    status: "EVIDENCE_CAPTURED",
    provider: "data_gouv",
    sourceKey: "approved-source",
    resourceKey: "approved-resource",
    tenantKey: null,
    capturedAt: "2026-07-20T00:00:00.000Z",
    productionEligible: false,
    permittedAccessMethod: "partner_feed",
    reviewedBy: "legal@example.test",
    approvalReference: "approval-2026-07-20",
    evidence: [
      {
        kind: "written_permission",
        reference: "approval-2026-07-20",
        artifactPath: "artifacts/job-ingestion/source-policy/approval.txt",
        artifactSha256: "a".repeat(64),
        supports: ["commercial_use", "redisplay", "retention", "access_method"],
      },
    ],
  };
}

describe("G016 source-policy result persistence", () => {
  test("persists complete rights evidence as an immutable digested record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hirly-source-policy-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "approved-source.json");

    const result = await persistSourcePolicyResult(output, evidenceResult());
    const persisted = JSON.parse(await readFile(output, "utf8"));

    expect(result.status).toBe("EVIDENCE_CAPTURED");
    expect(result.productionEligible).toBeFalse();
    expect(result.recordDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted).toEqual(result);
    expect(
      verifyPersistedSourcePolicyResult(persisted, {
        provider: "data_gouv",
        sourceKey: "approved-source",
        resourceKey: "approved-resource",
        tenantKey: null,
      }),
    ).toEqual(result);
    await expect(persistSourcePolicyResult(output, evidenceResult())).rejects.toThrow();
  });

  test("refuses to treat a public page as permission", () => {
    const result = evidenceResult();
    result.evidence[0]!.kind = "dataset_page" as "written_permission";
    expect(() => finalizeSourcePolicyResult(result)).toThrow("kind_is_not_rights_evidence");
  });

  test("refuses evidence that does not cover every required right", () => {
    const result = evidenceResult();
    result.evidence[0]!.supports = ["access_method"];
    expect(() => finalizeSourcePolicyResult(result)).toThrow(
      "rights_evidence_incomplete:commercial_use,redisplay,retention",
    );
  });

  test("persists a typed external block when approval evidence is unavailable", () => {
    const result = finalizeSourcePolicyResult({
      schemaVersion: "source-policy-result.v1",
      status: "BLOCKED_EXTERNAL",
      provider: "public_site",
      sourceKey: "public-but-unapproved",
      resourceKey: null,
      tenantKey: null,
      capturedAt: "2026-07-20T00:00:00.000Z",
      productionEligible: false,
      blockerCode: "COMMERCIAL_USE_NOT_APPROVED",
      reason: "The source is publicly readable but commercial use is not approved.",
      evidenceReferences: ["https://example.test/public-jobs"],
      missingEvidence: ["written commercial-use permission"],
      unblockProcedure: "Capture reviewed written permission and its SHA-256 digest.",
    });
    expect(result).toMatchObject({
      status: "BLOCKED_EXTERNAL",
      productionEligible: false,
      blockerCode: "COMMERCIAL_USE_NOT_APPROVED",
    });
  });

  test("rejects untyped or production-eligible outcomes", () => {
    expect(() =>
      finalizeSourcePolicyResult({
        ...evidenceResult(),
        status: "PUBLIC",
      }),
    ).toThrow("status_must_be_EVIDENCE_CAPTURED_or_BLOCKED_EXTERNAL");
    expect(() =>
      finalizeSourcePolicyResult({
        ...evidenceResult(),
        productionEligible: true,
      }),
    ).toThrow("productionEligible_must_be_false");
  });

  test("rejects scope mismatches and digest tampering", () => {
    const result = finalizeSourcePolicyResult(evidenceResult());
    expect(() =>
      verifyPersistedSourcePolicyResult(result, {
        provider: "data_gouv",
        sourceKey: "different-source",
        resourceKey: "approved-resource",
        tenantKey: null,
      }),
    ).toThrow("source_policy_scope_mismatch");
    expect(() =>
      verifyPersistedSourcePolicyResult({
        ...result,
        reviewedBy: "attacker@example.test",
      }),
    ).toThrow("source_policy_record_digest_mismatch");
    expect(() =>
      verifyPersistedSourcePolicyResult({
        ...result,
        publicReadable: true,
      }),
    ).toThrow("contains_unknown_fields:publicReadable");
  });
});
