import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeSourcePolicyResult } from "../src/source-policy-result";
import { provisionSourceTrial } from "../src/source-trial-provisioning";

const sourceId = "00000000-0000-4000-8000-000000000101";
const evidenceId = "00000000-0000-4000-8000-000000000102";
const policyId = "00000000-0000-4000-8000-000000000103";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

function reviewedEvidence(overrides: Record<string, unknown> = {}) {
  return finalizeSourcePolicyResult({
    schemaVersion: "source-policy-result.v1",
    status: "EVIDENCE_CAPTURED",
    provider: "greenhouse",
    sourceKey: "greenhouse:acme",
    resourceKey: null,
    tenantKey: "acme",
    capturedAt: "2026-07-20T10:00:00Z",
    productionEligible: false,
    permittedAccessMethod: "tenant_feed",
    reviewedBy: "legal@hirly.test",
    approvalReference: "approval:G016:acme",
    evidence: [
      {
        kind: "written_permission",
        reference: "approval:G016:acme",
        artifactPath: "artifacts/job-ingestion/source-policy/greenhouse-acme.txt",
        artifactSha256: "a".repeat(64),
        supports: [
          "commercial_use",
          "redisplay",
          "retention",
          "access_method",
        ],
      },
    ],
    ...overrides,
  });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "hirly.source-trial-provisioning.v1",
    source: {
      id: sourceId,
      provider: "greenhouse",
      sourceKey: "greenhouse:acme",
      tenantKey: "acme",
      companyName: "Acme",
      countryCodes: ["FR"],
      baseUrl: "https://boards.greenhouse.io/acme",
      accessType: "tenant_feed",
    },
    policyEvidence: {
      id: evidenceId,
      evidenceKey: "greenhouse-acme-g016",
      selectedEvidenceIndex: 0,
    },
    policy: {
      id: policyId,
      environment: "staging",
      startsAt: "2026-07-20T11:00:00Z",
      expiresAt: "2026-08-10T11:00:00Z",
      maxTotalRuns: 20,
      approvedBy: "legal@hirly.test",
      approvalReference: "approval:G016:acme",
      tenantSelectionEvidence: {
        reference: "artifacts/job-ingestion/ats-ranking.json",
        sha256: "b".repeat(64),
      },
    },
    manifest: {
      trialKey: "greenhouse:acme:g016:20260720",
      requestedAt: "2026-07-20T12:00:00Z",
      expiresAt: "2026-08-03T12:00:00Z",
      budget: {
        maxPages: 1,
        maxCandidates: 10_000,
        maxBytes: 10_000_000,
      },
    },
    ...overrides,
  };
}

describe("G016 source-trial provisioning", () => {
  test("generates review-only SQL and a bound non-production manifest", () => {
    const result = provisionSourceTrial(input(), reviewedEvidence());
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifest).toMatchObject({
      schemaVersion: "hirly.source-trial-manifest.v1",
      sourceId,
      provider: "greenhouse",
      tenantKey: "acme",
      environment: "staging",
      policyEvidenceId: evidenceId,
      tenantSelectionEvidence: {
        sha256: "b".repeat(64),
      },
    });
    expect(result.sql).toContain("REVIEW BEFORE EXECUTION");
    expect(result.sql).toContain("INSERT INTO public.career_sources");
    expect(result.sql).toContain("INSERT INTO public.source_policy_evidence");
    expect(result.sql).toContain("INSERT INTO public.source_trial_policies");
    expect(result.sql).toContain("'trial_approved'");
    expect(result.sql).toContain("false, false, false, false");
    expect(result.sql).toContain("'staging'");
    expect(result.sql).not.toContain("public.jobs");
    expect(result.sql).not.toContain("provider_registry");
    expect(result.sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
  });

  test("refuses blocked, tampered, mismatched or non-trial evidence", () => {
    const blocked = finalizeSourcePolicyResult({
      schemaVersion: "source-policy-result.v1",
      status: "BLOCKED_EXTERNAL",
      provider: "greenhouse",
      sourceKey: "greenhouse:acme",
      resourceKey: null,
      tenantKey: "acme",
      capturedAt: "2026-07-20T10:00:00Z",
      productionEligible: false,
      blockerCode: "COMMERCIAL_USE_NOT_APPROVED",
      reason: "Approval pending.",
      evidenceReferences: ["https://example.test/request"],
      missingEvidence: ["written approval"],
      unblockProcedure: "Record reviewed written permission.",
    });
    expect(() => provisionSourceTrial(input(), blocked)).toThrow("policy evidence is BLOCKED_EXTERNAL");
    expect(() =>
      provisionSourceTrial(input(), { ...reviewedEvidence(), recordDigest: "c".repeat(64) }),
    ).toThrow("source_policy_record_digest_mismatch");
    expect(() =>
      provisionSourceTrial(input(), reviewedEvidence({ tenantKey: "other" })),
    ).toThrow("source_policy_scope_mismatch");
    expect(() =>
      provisionSourceTrial(
        input(),
        reviewedEvidence({
          evidence: [
            {
              kind: "official_terms",
              reference: "terms",
              artifactPath: "artifacts/job-ingestion/source-policy/terms.txt",
              artifactSha256: "a".repeat(64),
              supports: [
                "commercial_use",
                "redisplay",
                "retention",
                "access_method",
              ],
            },
          ],
        }),
      ),
    ).toThrow("selected rights evidence cannot authorize");
  });

  test("refuses production, unsupported provider, invalid windows and source activation fields", () => {
    expect(() =>
      provisionSourceTrial(
        input({
          policy: {
            ...(input().policy as Record<string, unknown>),
            environment: "production",
          },
        }),
        reviewedEvidence(),
      ),
    ).toThrow("policy.environment must be non-production");
    expect(() =>
      provisionSourceTrial(
        input({
          source: {
            ...(input().source as Record<string, unknown>),
            provider: "smartrecruiters",
          },
        }),
        reviewedEvidence(),
      ),
    ).toThrow("has no trial runner");
    expect(() =>
      provisionSourceTrial(
        input({
          manifest: {
            ...(input().manifest as Record<string, unknown>),
            expiresAt: "2026-09-01T00:00:00Z",
          },
        }),
        reviewedEvidence(),
      ),
    ).toThrow("manifest window must be contained");
    expect(() =>
      provisionSourceTrial(
        input({
          source: {
            ...(input().source as Record<string, unknown>),
            enabled: true,
          },
        }),
        reviewedEvidence(),
      ),
    ).toThrow("source fields must be exactly");
  });

  test("supports exact qualified data.gouv resource scope only", () => {
    const tenantKey = "dataset-1:resource-1";
    const dataGouvInput = input({
      source: {
        ...(input().source as Record<string, unknown>),
        provider: "data_gouv",
        sourceKey: "csp-qualified-resource",
        tenantKey,
        companyName: null,
        baseUrl: "https://static.data.gouv.fr/resource.json",
        accessType: "open_data",
      },
    });
    const evidence = reviewedEvidence({
      provider: "data_gouv",
      sourceKey: "csp-qualified-resource",
      resourceKey: tenantKey,
      tenantKey,
      permittedAccessMethod: "open_data",
      evidence: [
        {
          kind: "licence_text",
          reference: "Open Licence 2.0",
          artifactPath: "artifacts/job-ingestion/source-policy/open-licence.txt",
          artifactSha256: "d".repeat(64),
          supports: [
            "commercial_use",
            "redisplay",
            "retention",
            "access_method",
          ],
        },
      ],
    });
    expect(provisionSourceTrial(dataGouvInput, evidence).manifest).toMatchObject({
      provider: "data_gouv",
      tenantKey,
    });
  });

  test("CLI writes new review artifacts without making database calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hirly-trial-provision-"));
    temporaryDirectories.push(directory);
    const inputPath = join(directory, "input.json");
    const evidencePath = join(directory, "evidence.json");
    const sqlPath = join(directory, "review.sql");
    const manifestPath = join(directory, "manifest.json");
    await writeFile(inputPath, JSON.stringify(input()));
    await writeFile(evidencePath, JSON.stringify(reviewedEvidence()));

    const process = Bun.spawn(
      [
        "bun",
        "src/source-trial-provisioning-cli.ts",
        "--input",
        inputPath,
        "--policy-evidence",
        evidencePath,
        "--sql-output",
        sqlPath,
        "--manifest-output",
        manifestPath,
      ],
      {
        cwd: new URL("..", import.meta.url).pathname,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "REVIEW_REQUIRED",
      canonicalWrites: false,
      sourceActivationChanges: false,
      databaseCalls: 0,
    });
    expect(await readFile(sqlPath, "utf8")).toContain("REVIEW BEFORE EXECUTION");
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      provider: "greenhouse",
      tenantKey: "acme",
    });

    const repeated = Bun.spawnSync(
      [
        "bun",
        "src/source-trial-provisioning-cli.ts",
        "--input",
        inputPath,
        "--policy-evidence",
        evidencePath,
        "--sql-output",
        sqlPath,
        "--manifest-output",
        manifestPath,
      ],
      { cwd: new URL("..", import.meta.url).pathname },
    );
    expect(repeated.exitCode).not.toBe(0);
  });
});
