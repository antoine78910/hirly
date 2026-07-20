import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceTrialManifest } from "@hirly/contracts";
import {
  persistAtsSourceTrial,
  previewAtsSourceTrial,
  type SourceTrialEvidenceRepository,
} from "../src/source-trial";
import {
  parseSourceTrialArgs,
  runSourceTrialCli,
} from "../src/source-trial-cli";

const manifest: SourceTrialManifest = {
  schemaVersion: "hirly.source-trial-manifest.v1",
  trialKey: "greenhouse:vaulttec:2026-07-20",
  sourceId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a90",
  provider: "greenhouse",
  tenantKey: "vaulttec",
  environment: "staging",
  countryCodes: ["FR"],
  policyEvidenceId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a91",
  requestedAt: "2026-07-20T11:00:00Z",
  expiresAt: "2026-07-21T11:00:00Z",
  budget: {
    maxPages: 1,
    maxCandidates: 100,
    maxBytes: 1_000_000,
  },
};

const response = {
  jobs: [
    {
      id: 42,
      title: "Ingénieur plateforme",
      location: { name: "Paris" },
      absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/42",
      content: "Build systems.",
    },
    {
      id: 42,
      title: "Ingénieur plateforme",
      location: { name: "Paris" },
      absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/42",
      content: "Build systems.",
    },
  ],
};

describe("G014 evidence-only source trial runner", () => {
  test("previews a bounded ATS trial with stable IDs and no mutation capability", async () => {
    const preview = await previewAtsSourceTrial({
      manifest,
      fetch: async () => Response.json(response),
      now: () => new Date("2026-07-20T12:00:00Z"),
      runId: "018f02d8-a8b8-7f1d-a419-bf38eaf22a92",
    });
    expect(preview).toMatchObject({
      fetched: 2,
      normalized: 1,
      rejected: 0,
      deduplicated: 1,
      complete: true,
      safeguards: {
        canonicalWrites: false,
        applicationWrites: false,
        queueWrites: false,
        providerOwnershipChanges: false,
        sourceActivationChanges: false,
      },
    });
    expect(preview.candidates[0].candidate).toMatchObject({
      provider: "greenhouse",
      externalId: "vaulttec:42",
      countryCode: "FR",
      atsProvider: "greenhouse",
      manualFulfillmentReady: true,
    });
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("persists only through the evidence repository interface", async () => {
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
    await persistAtsSourceTrial({
      manifest,
      repository,
      fetch: async () => Response.json({ jobs: [response.jobs[0]] }),
      now: () => new Date("2026-07-20T12:00:00Z"),
    });
    expect(calls).toEqual(["begin", "page", "candidate", "scorecard"]);
    expect(Object.keys(repository)).not.toContain("upsertCanonicalBatch");
    expect(Object.keys(repository)).not.toContain("enqueue");
  });

  test("rejects expired policy, unsupported providers and manifest budgets", async () => {
    await expect(
      previewAtsSourceTrial({
        manifest,
        fetch: async () => Response.json(response),
        now: () => new Date("2026-07-22T12:00:00Z"),
      }),
    ).rejects.toThrow("trial_policy_window_invalid");

    await expect(
      previewAtsSourceTrial({
        manifest: { ...manifest, provider: "france_travail" },
        fetch: async () => Response.json(response),
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toThrow("trial_provider_not_ready");

    await expect(
      previewAtsSourceTrial({
        manifest: {
          ...manifest,
          budget: { ...manifest.budget, maxCandidates: 1 },
        },
        fetch: async () => Response.json(response),
        now: () => new Date("2026-07-20T12:00:00Z"),
      }),
    ).rejects.toThrow("trial_budget_exceeded:maxCandidates");
  });

  test("CLI preview is fixture-only and a live run requires the dedicated trial role URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hirly-source-trial-"));
    const manifestPath = join(directory, "manifest.json");
    const responsePath = join(directory, "response.json");
    const outputPath = join(directory, "preview.json");
    const now = new Date();
    const currentManifest: SourceTrialManifest = {
      ...manifest,
      trialKey: `greenhouse:vaulttec:${now.getTime()}`,
      requestedAt: new Date(now.getTime() - 30_000).toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    };
    await Promise.all([
      writeFile(manifestPath, JSON.stringify(currentManifest)),
      writeFile(responsePath, JSON.stringify({ jobs: [response.jobs[0]] })),
    ]);
    const preview = parseSourceTrialArgs([
      "preview",
      "--manifest",
      manifestPath,
      "--response",
      responsePath,
      "--output",
      outputPath,
    ]);
    const result = await runSourceTrialCli(preview, {});
    expect(result).toMatchObject({
      safeguards: {
        canonicalWrites: false,
        applicationWrites: false,
        queueWrites: false,
      },
    });
    expect(JSON.parse(await readFile(outputPath, "utf8")).runId).toBe(
      result.runId,
    );

    const live = parseSourceTrialArgs([
      "run",
      "--manifest",
      manifestPath,
      "--output",
      join(directory, "run.json"),
    ]);
    await expect(runSourceTrialCli(live, {})).rejects.toThrow(
      "SOURCE_TRIAL_DATABASE_URL",
    );
    expect(() =>
      parseSourceTrialArgs([
        "run",
        "--manifest",
        manifestPath,
        "--response",
        responsePath,
        "--output",
        outputPath,
      ]),
    ).toThrow("rejects response fixtures");
  });
});
