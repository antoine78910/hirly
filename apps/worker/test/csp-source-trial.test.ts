import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type {
  SourceTrialManifest,
  SourceTrialResult,
} from "@hirly/contracts";
import {
  G016_SOURCE_POLICY_ARTIFACT_SHA256,
  QUALIFIED_CSP_BYTE_LENGTH,
  QUALIFIED_CSP_CONTENT_SHA256,
  QUALIFIED_CSP_DATASET_ID,
  QUALIFIED_CSP_RESOURCE_ID,
  QUALIFIED_CSP_RESOURCE_URL,
  createCspTrialTransport,
  cspQualifiedEvidenceReadiness,
  persistCspSourceTrial,
  previewCspSourceTrial,
  sealCspTrialResourceManifest,
  sealQualifiedCspTrialResourceManifest,
  type CspTrialResourceManifestInput,
} from "../src/csp-source-trial";
import type { SourceTrialEvidenceRepository } from "../src/source-trial";

const sourceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a90";
const policyEvidenceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a91";
const header = [
  "Organisme de rattachement",
  "Référence",
  "Intitulé du poste",
  "Employeur",
  "Localisation du poste",
  "Lieu d'affectation",
  "Date de début de publication par défaut",
  "Date de fin de publication par défaut",
].join(";");
const csv = `${header}
Administration Exemple;REF-1;"Ingénieure
plateforme";;Paris;;01/06/2026;31/07/2026
Administration Exemple;REF-1;Ingénieure plateforme;;Paris;;01/06/2026;31/07/2026
Administration Exemple;REF-2;Analyste données;;;Lyon;01/06/2026;30/06/2026
Administration Exemple;;Sans référence;;Marseille;;01/06/2026;31/07/2026
`;
const csvBytes = new TextEncoder().encode(csv);
const csvDigest = createHash("sha256").update(csvBytes).digest("hex");
const testResourceUrl =
  "https://static.data.gouv.fr/resources/csp-test/20260720/csp.csv";

function resourceManifestInput(
  overrides: Partial<CspTrialResourceManifestInput> = {},
): CspTrialResourceManifestInput {
  return {
    schemaVersion: "hirly.csp-evidence-trial-resource.v1",
    sourceId,
    policyEvidenceId,
    datasetId: QUALIFIED_CSP_DATASET_ID,
    resourceId: QUALIFIED_CSP_RESOURCE_ID,
    resourceUrl: testResourceUrl,
    contentSha256: csvDigest,
    byteLength: csvBytes.byteLength,
    sourcePolicyArtifactSha256: G016_SOURCE_POLICY_ARTIFACT_SHA256,
    snapshotDate: "2026-06-28",
    captureDate: "2026-07-20",
    expectedCounts: {
      parsedRows: 4,
      uniqueReferences: 2,
      activeAtSnapshotRows: 4,
      activeAtSnapshotUniqueReferences: 2,
      activeAtCaptureRows: 3,
      activeAtCaptureUniqueReferences: 1,
    },
    budgets: {
      maxRequests: 1,
      maxPages: 1,
      maxBytes: csvBytes.byteLength,
      timeoutMs: 1_000,
    },
    ...overrides,
  };
}

const manifest: SourceTrialManifest = {
  schemaVersion: "hirly.source-trial-manifest.v1",
  trialKey: `${QUALIFIED_CSP_DATASET_ID}:${QUALIFIED_CSP_RESOURCE_ID}:2026-07-20`,
  sourceId,
  provider: "data_gouv",
  tenantKey: `${QUALIFIED_CSP_DATASET_ID}:${QUALIFIED_CSP_RESOURCE_ID}`,
  environment: "staging",
  countryCodes: ["FR"],
  policyEvidenceId,
  tenantSelectionEvidence: {
    reference: "source-ranking/2026-07-20/csp-b3f661d.json",
    sha256: "b".repeat(64),
  },
  requestedAt: "2026-07-20T11:00:00Z",
  expiresAt: "2026-07-21T11:00:00Z",
  budget: {
    maxPages: 1,
    maxCandidates: 10,
    maxBytes: 10_000,
  },
};

function csvResponse(body = csv, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/csv",
      "content-length": String(new TextEncoder().encode(body).byteLength),
    },
  });
}

describe("G014 qualified CSP CSV evidence-only trial", () => {
  test("binds the CSP manifest to the complete G016 source-policy artifact", () => {
    const artifact = readFileSync(
      new URL(
        "../../../artifacts/job-ingestion/source-policy/g016-official-access-2026-07-20.json",
        import.meta.url,
      ),
    );

    expect(createHash("sha256").update(artifact).digest("hex")).toBe(
      G016_SOURCE_POLICY_ARTIFACT_SHA256,
    );
  });

  test("binds the exact b3f661d CSP resource and keeps BPCE blocked", () => {
    const sealed = sealQualifiedCspTrialResourceManifest({
      sourceId,
      policyEvidenceId,
    });
    expect(sealed).toMatchObject({
      datasetId: QUALIFIED_CSP_DATASET_ID,
      resourceId: QUALIFIED_CSP_RESOURCE_ID,
      resourceUrl: QUALIFIED_CSP_RESOURCE_URL,
      contentSha256: QUALIFIED_CSP_CONTENT_SHA256,
      byteLength: QUALIFIED_CSP_BYTE_LENGTH,
      sourcePolicyArtifactSha256: G016_SOURCE_POLICY_ARTIFACT_SHA256,
      expectedCounts: {
        parsedRows: 183_467,
        uniqueReferences: 181_643,
        activeAtSnapshotRows: 42_660,
        activeAtSnapshotUniqueReferences: 42_321,
        activeAtCaptureRows: 18_409,
        activeAtCaptureUniqueReferences: 18_242,
      },
    });
    expect(cspQualifiedEvidenceReadiness).toMatchObject({
      state: "qualified_evidence_only",
      trialTransportReady: true,
      productionReady: false,
      canonicalWriteReady: false,
    });
  });

  test("fetches one exact digest-bound CSV without credentials or redirects", async () => {
    const sealed = sealCspTrialResourceManifest(resourceManifestInput());
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport = createCspTrialTransport({
      resourceManifest: sealed,
      approvedManifestDigests: [sealed.manifestDigest],
      fetch: async (url, init) => {
        calls.push({ url, init });
        return csvResponse();
      },
    });
    expect(await transport.fetch(new AbortController().signal)).toBe(csv);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: testResourceUrl,
      init: {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    });
    expect(transport).toMatchObject({
      trialOnly: true,
      manualInvocationOnly: true,
      liveTransportReady: false,
      canonicalWriteReady: false,
      credentialsAccepted: false,
    });
  });

  test("parses quoted CSV, stable identities and exact bakeoff counts without actionable claims", async () => {
    const sealed = sealCspTrialResourceManifest(resourceManifestInput());
    const preview = await previewCspSourceTrial({
      manifest,
      resourceManifest: sealed,
      approvedManifestDigests: [sealed.manifestDigest],
      fetch: async () => csvResponse(),
      now: () => new Date("2026-07-20T12:00:00Z"),
      runId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a92",
    });
    expect(preview).toMatchObject({
      provider: "data_gouv",
      parsedRows: 4,
      normalized: 2,
      rejected: 1,
      deduplicated: 1,
      activeAtSnapshotRows: 4,
      activeAtSnapshotUniqueReferences: 2,
      activeAtCaptureRows: 3,
      activeAtCaptureUniqueReferences: 1,
      actionable: 0,
      safeguards: {
        canonicalWrites: false,
        applicationWrites: false,
        queueWrites: false,
        providerOwnershipChanges: false,
        sourceActivationChanges: false,
      },
    });
    expect(preview.candidates[0]).toMatchObject({
      candidateKey: `data_gouv:${QUALIFIED_CSP_DATASET_ID}:${QUALIFIED_CSP_RESOURCE_ID}:REF-1`,
      title: "Ingénieure\nplateforme",
      actionable: false,
      blocker: "no_canonical_apply_route",
    });
    expect(preview.evidencePage).toMatchObject({
      containsRawRows: false,
      containsPersonalData: false,
      blockers: ["no_canonical_apply_route"],
    });
    expect(JSON.stringify(preview.evidencePage)).not.toContain(
      "Administration Exemple",
    );
  });

  test("validates binding and allowlist before immutable G014 admission or network", async () => {
    const sealed = sealCspTrialResourceManifest(resourceManifestInput());
    const calls: string[] = [];
    const repository: SourceTrialEvidenceRepository = {
      async beginSourceTrial() {
        calls.push("begin");
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a92";
      },
      async recordSourceTrialPage() {
        throw new Error("must not persist");
      },
      async recordSourceTrialCandidate() {
        throw new Error("must not persist");
      },
      async recordSourceTrialScorecard() {
        throw new Error("must not persist");
      },
    };
    await expect(
      persistCspSourceTrial({
        manifest,
        resourceManifest: sealed,
        approvedManifestDigests: [],
        repository,
        fetch: async () => {
          calls.push("fetch");
          return csvResponse();
        },
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toThrow("not allowlisted");
    expect(calls).toEqual([]);

    expect(() =>
      sealCspTrialResourceManifest(
        resourceManifestInput({
          resourceUrl: `${testResourceUrl}?access_token=secret`,
        }),
      ),
    ).toThrow("query-free credential-free");
  });

  test("persists only aggregate page evidence, non-actionable candidates and terminal result", async () => {
    const sealed = sealCspTrialResourceManifest(resourceManifestInput());
    const calls: string[] = [];
    const pages: string[] = [];
    const candidates: string[] = [];
    const candidateHashes: string[] = [];
    const results: SourceTrialResult[] = [];
    const repository: SourceTrialEvidenceRepository = {
      async beginSourceTrial() {
        calls.push("begin");
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a92";
      },
      async recordSourceTrialPage(input) {
        calls.push("page");
        pages.push(input.serializedPayload);
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a93";
      },
      async recordSourceTrialCandidate(input) {
        calls.push("candidate");
        candidates.push(input.serializedCandidate);
        candidateHashes.push(input.contentHash);
      },
      async recordSourceTrialScorecard(input) {
        calls.push("scorecard");
        results.push(input.result);
      },
    };
    const preview = await persistCspSourceTrial({
      manifest,
      resourceManifest: sealed,
      approvedManifestDigests: [sealed.manifestDigest],
      repository,
      fetch: async () => csvResponse(),
      now: () => new Date("2026-07-20T12:00:00Z"),
    });
    expect(calls).toEqual([
      "begin",
      "page",
      "candidate",
      "candidate",
      "scorecard",
    ]);
    expect(pages[0]).toContain(sealed.contentSha256);
    expect(pages[0]).not.toContain("Administration Exemple");
    expect(candidates.every((value) => value.includes("no_canonical_apply_route")))
      .toBeTrue();
    expect(candidateHashes).toEqual(
      candidates.map((value) =>
        createHash("sha256").update(value).digest("hex"),
      ),
    );
    expect(results).toEqual([
      expect.objectContaining({
        status: "completed",
        pagesFetched: 1,
        candidatesObserved: 2,
        bytesStored: preview.evidenceByteCount,
        stopReason: null,
      }),
    ]);
    expect(Object.keys(repository)).not.toContain("upsertCanonicalBatch");
    expect(Object.keys(repository)).not.toContain("enqueue");
  });

  test("records policy_expired when a CSP failure crosses manifest expiry", async () => {
    const sealed = sealCspTrialResourceManifest(resourceManifestInput());
    const expiry = "2026-07-20T12:00:01.000Z";
    let currentTime = "2026-07-20T12:00:00.000Z";
    const calls: string[] = [];
    const results: SourceTrialResult[] = [];
    const repository: SourceTrialEvidenceRepository = {
      async beginSourceTrial() {
        calls.push("begin");
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a92";
      },
      async recordSourceTrialPage() {
        calls.push("page");
        throw new Error("expired trials must not append pages");
      },
      async recordSourceTrialCandidate() {
        calls.push("candidate");
        throw new Error("expired trials must not append candidates");
      },
      async recordSourceTrialScorecard(input) {
        calls.push("scorecard");
        results.push(input.result);
      },
    };

    await expect(
      persistCspSourceTrial({
        manifest: {
          ...manifest,
          trialKey: `${manifest.trialKey}:expiry-crossing`,
          requestedAt: "2026-07-20T11:59:00.000Z",
          expiresAt: expiry,
        },
        resourceManifest: sealed,
        approvedManifestDigests: [sealed.manifestDigest],
        repository,
        fetch: async () => {
          currentTime = "2026-07-20T12:00:01.100Z";
          return csvResponse("", 429);
        },
        now: () => new Date(currentTime),
      }),
    ).rejects.toMatchObject({ classification: "rate_limited" });

    expect(calls).toEqual(["begin", "scorecard"]);
    expect(results).toEqual([
      expect.objectContaining({
        status: "policy_expired",
        stopReason: "policy_expired",
        finishedAt: "2026-07-20T12:00:01.100Z",
        pagesFetched: 0,
        candidatesObserved: 0,
        bytesStored: 0,
      }),
    ]);
  });

  test("fails closed on content drift, count drift, bytes and classified HTTP errors", async () => {
    const sealed = sealCspTrialResourceManifest(resourceManifestInput());
    await expect(
      createCspTrialTransport({
        resourceManifest: sealed,
        approvedManifestDigests: [sealed.manifestDigest],
        fetch: async () =>
          csvResponse(csv.replace("Administration Exemple", "Administration ExemPle")),
      }).fetch(new AbortController().signal),
    ).rejects.toThrow("digest");

    const countDrift = sealCspTrialResourceManifest(
      resourceManifestInput({
        expectedCounts: {
          ...resourceManifestInput().expectedCounts,
          parsedRows: 5,
        },
      }),
    );
    await expect(
      previewCspSourceTrial({
        manifest,
        resourceManifest: countDrift,
        approvedManifestDigests: [countDrift.manifestDigest],
        fetch: async () => csvResponse(),
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toThrow("count mismatch:parsedRows");

    const overBudget = sealCspTrialResourceManifest(
      resourceManifestInput({
        byteLength: 8,
        contentSha256: "a".repeat(64),
        budgets: {
          maxRequests: 1,
          maxPages: 1,
          maxBytes: 8,
          timeoutMs: 1_000,
        },
      }),
    );
    await expect(
      createCspTrialTransport({
        resourceManifest: overBudget,
        approvedManifestDigests: [overBudget.manifestDigest],
        fetch: async () => csvResponse(),
      }).fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "budget_exceeded" });

    for (const [status, classification] of [
      [404, "not_found"],
      [429, "rate_limited"],
      [503, "retryable"],
      [403, "permanent"],
    ] as const) {
      await expect(
        createCspTrialTransport({
          resourceManifest: sealed,
          approvedManifestDigests: [sealed.manifestDigest],
          fetch: async () => csvResponse("", status),
        }).fetch(new AbortController().signal),
      ).rejects.toMatchObject({ classification, status });
    }

    await expect(
      createCspTrialTransport({
        resourceManifest: sealed,
        approvedManifestDigests: [sealed.manifestDigest],
        fetch: async () =>
          new Response(csv, {
            headers: { "content-type": "application/json" },
          }),
      }).fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "malformed" });

    const shortTimeout = sealCspTrialResourceManifest(
      resourceManifestInput({
        budgets: {
          maxRequests: 1,
          maxPages: 1,
          maxBytes: csvBytes.byteLength,
          timeoutMs: 5,
        },
      }),
    );
    await expect(
      createCspTrialTransport({
        resourceManifest: shortTimeout,
        approvedManifestDigests: [shortTimeout.manifestDigest],
        fetch: () => new Promise<Response>(() => {}),
      }).fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "budget_exceeded" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      createCspTrialTransport({
        resourceManifest: sealed,
        approvedManifestDigests: [sealed.manifestDigest],
        fetch: async () => csvResponse(),
      }).fetch(controller.signal),
    ).rejects.toMatchObject({ classification: "cancelled" });
  });
});
