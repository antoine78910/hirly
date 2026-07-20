import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type {
  SourceTrialManifest,
  SourceTrialResult,
} from "@hirly/contracts";
import {
  cspDataGouvTrialReadiness,
  createQualifiedDataGouvTrialTransport,
  persistDataGouvSourceTrial,
  previewDataGouvSourceTrial,
  sealDataGouvTrialResourceManifest,
  type DataGouvTrialResourceManifestInput,
} from "../src/data-gouv-source-trial";
import type { SourceTrialEvidenceRepository } from "../src/source-trial";

const sourceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a90";
const policyEvidenceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a91";
const datasetId = "qualified-employment-dataset";
const resourceId = "resource-2026-07";
const resourceUrl =
  "https://static.data.gouv.fr/resources/qualified-employment-dataset/20260720/resource.json";

function resourceManifestInput(
  overrides: Partial<DataGouvTrialResourceManifestInput> = {},
): DataGouvTrialResourceManifestInput {
  return {
    schemaVersion: "hirly.data-gouv-trial-resource.v1",
    sourceId,
    policyEvidenceId,
    datasetId,
    resourceId,
    resourceUrl,
    countryCodes: ["FR"],
    policyArtifactDigest: "a".repeat(64),
    qualification: {
      schemaVersion: "data-gouv-qualification.v1",
      datasetId,
      resourceId,
      evaluatedAt: "2026-07-20T00:00:00.000Z",
      decision: "qualified",
      blockReasons: [],
      evidenceDigest: "b".repeat(64),
      activationDefaults: {
        enabled: false,
        transportEnabled: false,
        incrementalEnabled: false,
        backfillEnabled: false,
      },
    },
    attribution: {
      licenceName: "Licence Ouverte 2.0",
      attributionText: "Source: qualified publisher via data.gouv.fr",
      sourceUrl:
        "https://www.data.gouv.fr/fr/datasets/qualified-employment-dataset/",
    },
    budgets: {
      maxRequests: 1,
      maxPages: 1,
      maxBytes: 100_000,
      timeoutMs: 1_000,
    },
    ...overrides,
  };
}

const manifest: SourceTrialManifest = {
  schemaVersion: "hirly.source-trial-manifest.v1",
  trialKey: `${datasetId}:${resourceId}:2026-07-20`,
  sourceId,
  provider: "data_gouv",
  tenantKey: `${datasetId}:${resourceId}`,
  environment: "staging",
  countryCodes: ["FR"],
  policyEvidenceId,
  requestedAt: "2026-07-20T11:00:00Z",
  expiresAt: "2026-07-21T11:00:00Z",
  budget: {
    maxPages: 1,
    maxCandidates: 100,
    maxBytes: 100_000,
  },
};

const row = {
  datasetId,
  resourceId,
  recordId: "job-001",
  title: "Ingénieure plateforme",
  employer: "Employeur Public",
  location: "Paris, France",
  countryCode: "France",
  description: "Construire des services.",
  contractType: "CDI",
  status: "active",
  applyUrls: ["https://apply.example.org/jobs/job-001"],
  sourceUrl:
    "https://www.data.gouv.fr/fr/datasets/qualified-employment-dataset/",
  publishedAt: "2026-07-19T08:00:00.000Z",
  expiresAt: "2026-08-19T08:00:00.000Z",
  sourceDocument: {
    reference: "job-001",
    email: "candidate@example.org",
  },
};

function response(rows = [row, row]): Response {
  return Response.json({
    schemaVersion: "hirly.data-gouv-trial-snapshot.v1",
    datasetId,
    resourceId,
    rows,
  });
}

describe("G014 qualified data.gouv evidence-only trial", () => {
  test("seals a qualified exact-resource manifest and binds one official request", async () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    const same = sealDataGouvTrialResourceManifest(resourceManifestInput());
    expect(sealed.manifestDigest).toBe(same.manifestDigest);
    expect(Object.isFrozen(sealed)).toBeTrue();
    expect(Object.isFrozen(sealed.qualification)).toBeTrue();

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport = createQualifiedDataGouvTrialTransport({
      resourceManifest: sealed,
      approvedManifestDigests: [sealed.manifestDigest],
      fetch: async (url, init) => {
        calls.push({ url, init });
        return response([row]);
      },
    });
    expect(await transport.fetch(new AbortController().signal)).toMatchObject({
      datasetId,
      resourceId,
      rows: [{ recordId: "job-001" }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: resourceUrl,
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

  test("normalizes and deduplicates candidates without exposing mutation capabilities", async () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    const preview = await previewDataGouvSourceTrial({
      manifest,
      resourceManifest: sealed,
      approvedManifestDigests: [sealed.manifestDigest],
      fetch: async () => response(),
      now: () => new Date("2026-07-20T12:00:00Z"),
      runId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a92",
    });
    expect(preview).toMatchObject({
      provider: "data_gouv",
      sourceKey: `${datasetId}:${resourceId}`,
      fetched: 2,
      normalized: 1,
      rejected: 0,
      deduplicated: 1,
      requestCount: 1,
      pageCount: 1,
      complete: true,
      safeguards: {
        canonicalWrites: false,
        applicationWrites: false,
        queueWrites: false,
        providerOwnershipChanges: false,
        sourceActivationChanges: false,
      },
    });
    expect(preview.candidates[0]).toMatchObject({
      candidateKey: `data_gouv:${datasetId}:${resourceId}:job-001`,
      candidate: {
        provider: "data_gouv",
        externalId: `${datasetId}:${resourceId}:job-001`,
        countryCode: "FR",
        selectedApplyUrl: "https://apply.example.org/jobs/job-001",
      },
    });
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.pageContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(preview.rawPage)).not.toContain(
      "candidate@example.org",
    );
  });

  test("persists only immutable G014 evidence and a reconciled terminal result", async () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    const calls: string[] = [];
    const payloads: string[] = [];
    const results: SourceTrialResult[] = [];
    const repository: SourceTrialEvidenceRepository = {
      async beginSourceTrial() {
        calls.push("begin");
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a92";
      },
      async recordSourceTrialPage(input) {
        calls.push("page");
        payloads.push(input.serializedPayload);
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a93";
      },
      async recordSourceTrialCandidate() {
        calls.push("candidate");
      },
      async recordSourceTrialScorecard(input) {
        calls.push("scorecard");
        results.push(input.result);
      },
    };

    const preview = await persistDataGouvSourceTrial({
      manifest,
      resourceManifest: sealed,
      approvedManifestDigests: [sealed.manifestDigest],
      repository,
      fetch: async () => response([row]),
      now: () => new Date("2026-07-20T12:00:00Z"),
    });
    expect(calls).toEqual(["begin", "page", "candidate", "scorecard"]);
    expect(payloads[0]).toContain(sealed.manifestDigest);
    expect(results).toEqual([
      expect.objectContaining({
        status: "completed",
        pagesFetched: 1,
        candidatesObserved: 1,
        bytesStored: preview.byteCount,
        stopReason: null,
      }),
    ]);
    expect(Object.keys(repository)).not.toContain("upsertCanonicalBatch");
    expect(Object.keys(repository)).not.toContain("enqueue");
  });

  test("rejects unapproved resource admission before evidence or network activity", async () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    const calls: string[] = [];
    const repository: SourceTrialEvidenceRepository = {
      async beginSourceTrial() {
        calls.push("begin");
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a92";
      },
      async recordSourceTrialPage() {
        calls.push("page");
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a93";
      },
      async recordSourceTrialCandidate() {
        calls.push("candidate");
      },
      async recordSourceTrialScorecard() {
        calls.push("scorecard");
      },
    };
    await expect(
      persistDataGouvSourceTrial({
        manifest,
        resourceManifest: sealed,
        approvedManifestDigests: [],
        repository,
        fetch: async () => {
          calls.push("fetch");
          return response([row]);
        },
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toThrow("not allowlisted");
    expect(calls).toEqual([]);
  });

  test("fails closed on absent policy/resource evidence, tampering and budgets", async () => {
    expect(cspDataGouvTrialReadiness).toMatchObject({
      state: "qualified_evidence_only",
      trialTransportReady: true,
      productionReady: false,
      canonicalWriteReady: false,
      transportModule: "./csp-source-trial",
    });
    expect(() =>
      sealDataGouvTrialResourceManifest(
        resourceManifestInput({
          qualification: {
            ...resourceManifestInput().qualification,
            decision: "rejected" as "qualified",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      sealDataGouvTrialResourceManifest(
        resourceManifestInput({
          resourceUrl: "https://evil.example/resource.json",
        }),
      ),
    ).toThrow();
    expect(() =>
      sealDataGouvTrialResourceManifest(
        resourceManifestInput({
          resourceUrl:
            "https://static.data.gouv.fr/resources/resource.json?access_token=secret",
        }),
      ),
    ).toThrow("credential-free HTTPS resource");

    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    expect(() =>
      createQualifiedDataGouvTrialTransport({
        resourceManifest: sealed,
        approvedManifestDigests: [],
      }),
    ).toThrow("not allowlisted");
    expect(() =>
      createQualifiedDataGouvTrialTransport({
        resourceManifest: {
          ...sealed,
          policyArtifactDigest: "c".repeat(64),
        },
        approvedManifestDigests: [sealed.manifestDigest],
      }),
    ).toThrow("manifest digest mismatch");

    await expect(
      previewDataGouvSourceTrial({
        manifest: { ...manifest, budget: { ...manifest.budget, maxCandidates: 1 } },
        resourceManifest: sealed,
        approvedManifestDigests: [sealed.manifestDigest],
        fetch: async () => response(),
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toThrow("trial_budget_exceeded:maxCandidates");

    const oversized = sealDataGouvTrialResourceManifest(
      resourceManifestInput({
        budgets: {
          maxRequests: 1,
          maxPages: 1,
          maxBytes: 8,
          timeoutMs: 1_000,
        },
      }),
    );
    await expect(
      createQualifiedDataGouvTrialTransport({
        resourceManifest: oversized,
        approvedManifestDigests: [oversized.manifestDigest],
        fetch: async () =>
          response([row]),
      }).fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "budget_exceeded" });
  });

  test("records classified failure evidence after G014 admission", async () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    const results: SourceTrialResult[] = [];
    const repository: SourceTrialEvidenceRepository = {
      async beginSourceTrial() {
        return "018f02d8-a8b8-7f1d-a419-bf38eaf22a92";
      },
      async recordSourceTrialPage() {
        throw new Error("failed trials must not record a page");
      },
      async recordSourceTrialCandidate() {
        throw new Error("failed trials must not record a candidate");
      },
      async recordSourceTrialScorecard(input) {
        results.push(input.result);
      },
    };
    await expect(
      persistDataGouvSourceTrial({
        manifest,
        resourceManifest: sealed,
        approvedManifestDigests: [sealed.manifestDigest],
        repository,
        fetch: async () => new Response("", { status: 429 }),
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toMatchObject({ classification: "rate_limited" });
    expect(results).toEqual([
      expect.objectContaining({
        status: "failed",
        stopReason: "rate_limited",
        pagesFetched: 0,
        candidatesObserved: 0,
        bytesStored: 0,
      }),
    ]);
  });

  test("records policy_expired when a data.gouv failure crosses manifest expiry", async () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
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
      persistDataGouvSourceTrial({
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
          return new Response("", { status: 429 });
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

  test("keeps the manifest digest content-addressed", () => {
    const sealed = sealDataGouvTrialResourceManifest(resourceManifestInput());
    const { manifestDigest, ...unsigned } = sealed;
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (value !== null && typeof value === "object") {
        return `{${Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    expect(manifestDigest).toBe(
      createHash("sha256").update(canonical(unsigned)).digest("hex"),
    );
  });
});
