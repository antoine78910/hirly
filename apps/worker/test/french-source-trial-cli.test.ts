import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { SourceTrialManifest } from "@hirly/contracts";
import {
  BPCE_DATASET_ID,
  BPCE_RESOURCE_ID,
  BPCE_RESOURCE_URL,
  sanitizedBpceSnapshotDigest,
  sealBpceTrialResourceManifest,
} from "../src/bpce-source-trial";
import { sealCspTrialResourceManifest } from "../src/csp-source-trial";
import { sealDataGouvTrialResourceManifest } from "../src/data-gouv-source-trial";
import {
  parseFrenchSourceTrialArgs,
  runFrenchSourceTrialCli,
} from "../src/french-source-trial-cli";

const sourceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a90";
const policyEvidenceId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a91";

describe("G014 French source trial operator CLI", () => {
  test("previews a sealed CSP fixture without canonical or activation writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hirly-csp-trial-"));
    try {
      const csv = [
        [
          "Organisme de rattachement",
          "Référence",
          "Intitulé du poste",
          "Employeur",
          "Localisation du poste",
          "Lieu d'affectation",
          "Date de début de publication par défaut",
          "Date de fin de publication par défaut",
        ].join(";"),
        [
          "Service public",
          "CSP-001",
          "Ingénieure plateforme",
          "Administration Exemple",
          "Paris",
          "",
          "01/07/2026",
          "31/07/2026",
        ].join(";"),
        "",
      ].join("\n");
      const byteLength = Buffer.byteLength(csv, "utf8");
      const resource = sealCspTrialResourceManifest({
        schemaVersion: "hirly.csp-evidence-trial-resource.v1",
        sourceId,
        policyEvidenceId,
        datasetId: "csp-test-dataset",
        resourceId: "csp-test-resource",
        resourceUrl:
          "https://static.data.gouv.fr/resources/csp-test/20260720/offres.csv",
        contentSha256: sha256(csv),
        byteLength,
        sourcePolicyArtifactSha256: "a".repeat(64),
        snapshotDate: "2026-07-20",
        captureDate: "2026-07-20",
        expectedCounts: {
          parsedRows: 1,
          uniqueReferences: 1,
          activeAtSnapshotRows: 1,
          activeAtSnapshotUniqueReferences: 1,
          activeAtCaptureRows: 1,
          activeAtCaptureUniqueReferences: 1,
        },
        budgets: {
          maxRequests: 1,
          maxPages: 1,
          maxBytes: byteLength,
          timeoutMs: 1_000,
        },
      });
      const manifest = trialManifest({
        tenantKey: "csp-test-dataset:csp-test-resource",
        maxCandidates: 1,
        maxBytes: byteLength,
      });
      const paths = await writeTrialInputs(directory, manifest, resource, csv);
      const command = parseFrenchSourceTrialArgs([
        "csp",
        "preview",
        "--manifest",
        paths.manifest,
        "--resource-manifest",
        paths.resource,
        "--approved-manifest-digest",
        resource.manifestDigest,
        "--response",
        paths.response,
        "--output",
        paths.output,
      ]);

      const result = await runFrenchSourceTrialCli(command, {});

      expect(result).toMatchObject({
        provider: "data_gouv",
        normalized: 1,
        actionable: 0,
        safeguards: {
          canonicalWrites: false,
          applicationWrites: false,
          queueWrites: false,
          providerOwnershipChanges: false,
          sourceActivationChanges: false,
        },
      });
      expect(JSON.parse(await readFile(paths.output, "utf8"))).toMatchObject({
        digest: result.digest,
        safeguards: { canonicalWrites: false, sourceActivationChanges: false },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("previews one exact qualified data.gouv resource and rejects digest drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hirly-data-gouv-trial-"));
    try {
      const datasetId = "qualified-employment-dataset";
      const resourceId = "resource-2026-07";
      const resource = sealDataGouvTrialResourceManifest({
        schemaVersion: "hirly.data-gouv-trial-resource.v1",
        sourceId,
        policyEvidenceId,
        datasetId,
        resourceId,
        resourceUrl:
          "https://static.data.gouv.fr/resources/qualified-employment-dataset/20260720/resource.json",
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
      });
      const manifest = trialManifest({
        tenantKey: `${datasetId}:${resourceId}`,
        maxCandidates: 10,
        maxBytes: 100_000,
      });
      const fixture = JSON.stringify({
        schemaVersion: "hirly.data-gouv-trial-snapshot.v1",
        datasetId,
        resourceId,
        rows: [
          {
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
            sourceDocument: { reference: "job-001" },
          },
        ],
      });
      const paths = await writeTrialInputs(
        directory,
        manifest,
        resource,
        fixture,
      );
      const command = parseFrenchSourceTrialArgs([
        "data-gouv",
        "preview",
        "--manifest",
        paths.manifest,
        "--resource-manifest",
        paths.resource,
        "--approved-manifest-digest",
        resource.manifestDigest,
        "--response",
        paths.response,
        "--output",
        paths.output,
      ]);

      const result = await runFrenchSourceTrialCli(command, {});
      expect(result).toMatchObject({
        provider: "data_gouv",
        sourceKey: `${datasetId}:${resourceId}`,
        normalized: 1,
        safeguards: { canonicalWrites: false, sourceActivationChanges: false },
      });

      const live = parseFrenchSourceTrialArgs([
        "data-gouv",
        "run",
        "--manifest",
        paths.manifest,
        "--resource-manifest",
        paths.resource,
        "--approved-manifest-digest",
        resource.manifestDigest,
        "--output",
        join(directory, "run.json"),
      ]);
      await expect(runFrenchSourceTrialCli(live, {})).rejects.toThrow(
        "SOURCE_TRIAL_DATABASE_URL is required",
      );

      await expect(
        runFrenchSourceTrialCli(
          { ...command, approvedManifestDigest: "f".repeat(64) },
          {},
        ),
      ).rejects.toThrow("not allowlisted");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps fixture input preview-only and live evidence runs credential-gated", async () => {
    expect(() =>
      parseFrenchSourceTrialArgs([
        "csp",
        "run",
        "--manifest",
        "trial.json",
        "--resource-manifest",
        "resource.json",
        "--approved-manifest-digest",
        "a".repeat(64),
        "--response",
        "fixture.csv",
        "--output",
        "result.json",
      ]),
    ).toThrow("run rejects response fixtures");
    expect(() =>
      parseFrenchSourceTrialArgs([
        "data-gouv",
        "preview",
        "--manifest",
        "trial.json",
        "--resource-manifest",
        "resource.json",
        "--approved-manifest-digest",
        "not-a-digest",
        "--response",
        "fixture.json",
        "--output",
        "result.json",
      ]),
    ).toThrow("exact approved SHA-256 digest");
  });

  test("previews a digest-bound BPCE snapshot with production writes disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hirly-bpce-trial-"));
    try {
      const rows = [{
        title: "Ingénieure plateforme",
        lastmodifieddate: "20/07/2026 4:10:08 PM",
        referencenumber: "BPCE-CLI-001",
        apply_url: "https://jobs.smartrecruiters.com/BPCE/744000123456789-role",
        url: "https://recrutement.bpce.fr/offre/role",
        company: "BPCE",
        city: "Paris",
        state: "Île-de-France",
        country: "France",
        description: "Construire des services.",
        jobtype: "CDI",
        nom_recruteur_principal: "Ne pas persister",
        email_recruteur_principal: "secret@example.com",
      }];
      const fixture = JSON.stringify(rows);
      const resource = sealBpceTrialResourceManifest({
        schemaVersion: "hirly.bpce-evidence-trial-resource.v1",
        sourceId,
        policyEvidenceId,
        datasetId: BPCE_DATASET_ID,
        resourceId: BPCE_RESOURCE_ID,
        resourceUrl: BPCE_RESOURCE_URL,
        countryCodes: ["FR"],
        sanitizedContentSha256: sanitizedBpceSnapshotDigest(rows),
        expectedRecords: 1,
        policyArtifactDigest: "a".repeat(64),
        attribution: {
          licenceName: "Licence Ouverte 2.0",
          attributionText: "Source: Groupe BPCE via data.gouv.fr",
          sourceUrl:
            "https://www.data.gouv.fr/datasets/groupe-bpce-offres-emploi-publiques",
        },
        budgets: {
          maxRequests: 1,
          maxPages: 1,
          maxBytes: 100_000,
          timeoutMs: 1_000,
        },
      });
      const trial = trialManifest({
        tenantKey: `${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}`,
        maxCandidates: 10,
        maxBytes: 100_000,
      });
      const paths = await writeTrialInputs(directory, trial, resource, fixture);
      const command = parseFrenchSourceTrialArgs([
        "bpce",
        "preview",
        "--manifest",
        paths.manifest,
        "--resource-manifest",
        paths.resource,
        "--approved-manifest-digest",
        resource.manifestDigest,
        "--response",
        paths.response,
        "--output",
        paths.output,
      ]);
      const result = await runFrenchSourceTrialCli(command, {});
      expect(result).toMatchObject({
        normalized: 1,
        actionable: 1,
        safeguards: {
          canonicalWrites: false,
          sourceActivationChanges: false,
        },
      });
      expect(await readFile(paths.output, "utf8")).not.toContain(
        "secret@example.com",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function trialManifest(input: {
  tenantKey: string;
  maxCandidates: number;
  maxBytes: number;
}): SourceTrialManifest {
  const now = Date.now();
  return {
    schemaVersion: "hirly.source-trial-manifest.v1",
    trialKey: `${input.tenantKey}:${randomUUID()}`,
    sourceId,
    provider: "data_gouv",
    tenantKey: input.tenantKey,
    environment: "staging",
    countryCodes: ["FR"],
    policyEvidenceId,
    tenantSelectionEvidence: {
      reference: `source-ranking/2026-07-20/${input.tenantKey}.json`,
      sha256: "c".repeat(64),
    },
    requestedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    budget: {
      maxPages: 1,
      maxCandidates: input.maxCandidates,
      maxBytes: input.maxBytes,
    },
  };
}

async function writeTrialInputs(
  directory: string,
  manifest: SourceTrialManifest,
  resource: unknown,
  response: string,
): Promise<{
  manifest: string;
  resource: string;
  response: string;
  output: string;
}> {
  const paths = {
    manifest: join(directory, "trial.json"),
    resource: join(directory, "resource.json"),
    response: join(directory, "response.fixture"),
    output: join(directory, "output.json"),
  };
  await Promise.all([
    writeFile(paths.manifest, JSON.stringify(manifest)),
    writeFile(paths.resource, JSON.stringify(resource)),
    writeFile(paths.response, response),
  ]);
  return paths;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
