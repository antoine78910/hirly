import { describe, expect, test } from "bun:test";
import type { SourceTrialManifest, SourceTrialResult } from "@hirly/contracts";
import {
  BPCE_DATASET_ID,
  BPCE_RESOURCE_ID,
  BPCE_RESOURCE_URL,
  bpceEvidenceTrialReadiness,
  createBpceTrialTransport,
  persistBpceSourceTrial,
  previewBpceSourceTrial,
  sanitizedBpceSnapshotDigest,
  sanitizeBpceUpstreamSnapshot,
  sealBpceTrialResourceManifest,
} from "../src/bpce-source-trial";
import { AtsTrialTransportError } from "../src/providers/ats-trial-transport";
import type { SourceTrialEvidenceRepository } from "../src/source-trial";

const sourceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a90";
const policyEvidenceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a91";
const now = new Date("2026-07-20T12:00:00.000Z");

const rawRecord = {
  title: "Ingénieure plateforme",
  lastmodifieddate: "20/07/2026 4:10:08 PM",
  referencenumber: "BPCE-001",
  apply_url: "https://jobs.smartrecruiters.com/BPCE/744000123456789-ingenieure-plateforme",
  url: "https://recrutement.bpce.fr/offre/ingenieure-plateforme",
  company: "BPCE",
  city: "Paris",
  state: "Île-de-France",
  country: "France",
  description: "Construire des services financiers fiables.",
  category: "Technologie",
  jobcode: "ENG",
  jobtype: "CDI",
  jobindustry: "Banque",
  organization: "Groupe BPCE",
  teletravail: "Hybride",
  nom_recruteur_principal: "Personne Confidentielle",
  email_recruteur_principal: "recruteur-secret@example.com",
};

const sanitizedDigest = sanitizedBpceSnapshotDigest([rawRecord]);
const resourceManifest = sealBpceTrialResourceManifest({
  schemaVersion: "hirly.bpce-evidence-trial-resource.v1",
  sourceId,
  policyEvidenceId,
  datasetId: BPCE_DATASET_ID,
  resourceId: BPCE_RESOURCE_ID,
  resourceUrl: BPCE_RESOURCE_URL,
  countryCodes: ["FR"],
  sanitizedContentSha256: sanitizedDigest,
  expectedRecords: 1,
  policyArtifactDigest: "a".repeat(64),
  attribution: {
    licenceName: "Licence Ouverte 2.0",
    attributionText: "Source: Groupe BPCE via data.gouv.fr",
    sourceUrl: "https://www.data.gouv.fr/datasets/groupe-bpce-offres-emploi-publiques",
  },
  budgets: {
    maxRequests: 1,
    maxPages: 1,
    maxBytes: 100_000,
    timeoutMs: 1_000,
  },
});

const manifest: SourceTrialManifest = {
  schemaVersion: "hirly.source-trial-manifest.v1",
  trialKey: `${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}:test`,
  sourceId,
  provider: "data_gouv",
  tenantKey: `${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}`,
  environment: "staging",
  countryCodes: ["FR"],
  policyEvidenceId,
  tenantSelectionEvidence: {
    reference: "source-ranking/2026-07-20/bpce.json",
    sha256: "b".repeat(64),
  },
  requestedAt: "2026-07-20T11:00:00.000Z",
  expiresAt: "2026-07-21T11:00:00.000Z",
  budget: {
    maxPages: 1,
    maxCandidates: 10,
    maxBytes: 100_000,
  },
};

function jsonResponse(
  body: string = JSON.stringify([rawRecord]),
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body, "utf8")),
      ...headers,
    },
  });
}

describe("BPCE official-feed evidence-only trial", () => {
  test("strips recruiter PII before hashing, evidence serialization, and persistence", async () => {
    const sanitized = sanitizeBpceUpstreamSnapshot([rawRecord]);
    expect(JSON.stringify(sanitized)).not.toContain("Personne Confidentielle");
    expect(JSON.stringify(sanitized)).not.toContain("recruteur-secret@example.com");

    const repository = new RecordingRepository();
    const preview = await persistBpceSourceTrial({
      manifest,
      resourceManifest,
      approvedManifestDigests: [resourceManifest.manifestDigest],
      repository,
      fetch: async () => jsonResponse(),
      now: () => now,
    });
    const persisted = JSON.stringify(repository);
    expect(persisted).not.toContain("Personne Confidentielle");
    expect(persisted).not.toContain("recruteur-secret@example.com");
    expect(preview).toMatchObject({
      fetched: 1,
      normalized: 1,
      actionable: 1,
      sanitizedContentHash: sanitizedDigest,
      safeguards: {
        canonicalWrites: false,
        applicationWrites: false,
        queueWrites: false,
        providerOwnershipChanges: false,
        sourceActivationChanges: false,
        recruiterPiiPersisted: false,
      },
    });
    expect(repository.pages).toHaveLength(1);
    expect(repository.candidates).toHaveLength(1);
    expect(repository.results[0]).toMatchObject({
      status: "completed",
      pagesFetched: 1,
      candidatesObserved: 1,
    });
  });

  test("accepts the current upstream scalar/null shape before sanitization", () => {
    const snapshot = sanitizeBpceUpstreamSnapshot([
      {
        ...rawRecord,
        country: null,
        zipcode: 75001,
        manager_bpce: true,
        description: null,
      },
    ]);
    expect(snapshot.records[0]).toMatchObject({
      location: "Paris, Île-de-France",
      countryCode: "FR",
      description: "",
    });
    expect(JSON.stringify(snapshot)).not.toContain("75001");
    expect(JSON.stringify(snapshot)).not.toContain("manager_bpce");
  });

  test("derives stable source identity, canonical apply route, and ATS metadata", async () => {
    const preview = await previewBpceSourceTrial({
      manifest,
      resourceManifest,
      approvedManifestDigests: [resourceManifest.manifestDigest],
      fetch: async () => jsonResponse(),
      now: () => now,
      runId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a92",
    });
    expect(preview.candidates[0]).toMatchObject({
      candidateKey: `data_gouv:${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}:BPCE-001`,
      atsProvider: "smartrecruiters",
      atsPostingId: "744000123456789",
      canonicalApplyUrl: rawRecord.apply_url,
      candidate: {
        externalId: `${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}:BPCE-001`,
        selectedApplyUrl: rawRecord.apply_url,
      },
    });
  });

  test("uses the exact official resource without redirects or credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport = createBpceTrialTransport({
      resourceManifest,
      approvedManifestDigests: [resourceManifest.manifestDigest],
      fetch: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse();
      },
    });
    await transport.fetch(new AbortController().signal);
    expect(calls).toEqual([
      {
        url: BPCE_RESOURCE_URL,
        init: expect.objectContaining({
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        }),
      },
    ]);
    expect(transport).toMatchObject({
      trialOnly: true,
      manualInvocationOnly: true,
      liveTransportReady: false,
      productionEligible: false,
      canonicalWriteReady: false,
      credentialsAccepted: false,
    });
    expect(bpceEvidenceTrialReadiness).toMatchObject({
      state: "BLOCKED_EXTERNAL",
      trialTransportImplemented: true,
      trialTransportReady: false,
      productionReady: false,
      productionEligible: false,
      canonicalWriteReady: false,
      sourceEnablementReady: false,
    });
  });

  test("fails closed on allowlist, content type, declared size, digest, and count drift", async () => {
    expect(() =>
      createBpceTrialTransport({
        resourceManifest,
        approvedManifestDigests: ["f".repeat(64)],
      }),
    ).toThrow("not allowlisted");

    const cases: Array<{
      response: Response;
      classification: AtsTrialTransportError["classification"];
      message: string;
    }> = [
      {
        response: jsonResponse("[]", { "content-type": "text/html" }),
        classification: "malformed",
        message: "JSON content type",
      },
      {
        response: jsonResponse("[]", { "content-length": "100001" }),
        classification: "budget_exceeded",
        message: "byte budget",
      },
      {
        response: new Response("x".repeat(100_001), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        classification: "budget_exceeded",
        message: "byte budget",
      },
      {
        response: jsonResponse("[]"),
        classification: "malformed",
        message: "record count",
      },
      {
        response: jsonResponse(JSON.stringify([{ ...rawRecord, title: "Titre modifié" }])),
        classification: "malformed",
        message: "digest",
      },
    ];
    for (const item of cases) {
      const transport = createBpceTrialTransport({
        resourceManifest,
        approvedManifestDigests: [resourceManifest.manifestDigest],
        fetch: async () => item.response,
      });
      try {
        await transport.fetch(new AbortController().signal);
        throw new Error("expected transport failure");
      } catch (error) {
        expect(error).toBeInstanceOf(AtsTrialTransportError);
        expect((error as AtsTrialTransportError).classification).toBe(item.classification);
        expect((error as Error).message).toContain(item.message);
      }
    }
  });

  test("enforces the time budget even when an injected fetch ignores abort", async () => {
    const { manifestDigest: _manifestDigest, ...unsigned } = resourceManifest;
    const fastTimeoutManifest = sealBpceTrialResourceManifest({
      ...unsigned,
      budgets: { ...resourceManifest.budgets, timeoutMs: 5 },
    });
    const transport = createBpceTrialTransport({
      resourceManifest: fastTimeoutManifest,
      approvedManifestDigests: [fastTimeoutManifest.manifestDigest],
      fetch: async () => await new Promise<Response>(() => undefined),
    });
    await expect(transport.fetch(new AbortController().signal)).rejects.toMatchObject({
      classification: "budget_exceeded",
    });
  });
});

class RecordingRepository implements SourceTrialEvidenceRepository {
  pages: unknown[] = [];
  candidates: unknown[] = [];
  results: SourceTrialResult[] = [];

  async beginSourceTrial(): Promise<string> {
    return "018f02d8-a8b8-7f1d-a419-bf38eaf22a93";
  }
  async recordSourceTrialPage(input: unknown): Promise<string> {
    this.pages.push(input);
    return "018f02d8-a8b8-7f1d-a419-bf38eaf22a94";
  }
  async recordSourceTrialCandidate(input: unknown): Promise<void> {
    this.candidates.push(input);
  }
  async recordSourceTrialScorecard(input: { result: SourceTrialResult }): Promise<void> {
    this.results.push(input.result);
  }
}
