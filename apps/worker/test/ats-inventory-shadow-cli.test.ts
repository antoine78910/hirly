import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  parseAtsInventoryShadowArgs,
  runAtsInventoryShadowCli,
} from "../src/ats-inventory-shadow-cli";

const now = new Date("2026-07-21T00:00:00.000Z");

function policy() {
  return {
    schemaVersion: 1,
    provider: "greenhouse",
    mode: "shadow",
    canonicalWritesEnabled: false,
    policyId: "greenhouse-fr-shadow",
    policyExpiresAt: "2026-08-21T00:00:00.000Z",
    tenantAllowlist: ["vaulttec"],
    countryAllowlist: ["FR"],
  };
}

function runCommand(root: string, output: string) {
  return parseAtsInventoryShadowArgs([
    "run", "--provider", "greenhouse", "--tenant", "vaulttec", "--country", "FR",
    "--policy", join(root, "policy.json"), "--output", output, "--evidence-root", root, "--live",
  ]);
}

function greenhouseResponse(id: string) {
  return Response.json({
    jobs: [{
      id,
      title: "Shadow job",
      location: { name: "Paris, France" },
      absolute_url: `https://boards.greenhouse.io/vaulttec/jobs/${id}`,
      content: "Read-only shadow fixture",
    }],
  });
}

describe("ATS inventory shadow CLI", () => {
  test("requires an explicit valueless --live flag and fixed run scope", () => {
    expect(() => parseAtsInventoryShadowArgs([
      "run", "--provider", "greenhouse", "--tenant", "vaulttec", "--country", "FR",
      "--policy", "policy.json", "--output", "run.json", "--evidence-root", ".",
    ])).toThrow("--live true");
    expect(() => parseAtsInventoryShadowArgs([
      "run", "--provider", "greenhouse", "--tenant", "*", "--country", "FR",
      "--policy", "policy.json", "--output", "run.json", "--evidence-root", ".", "--live",
    ])).toThrow("exact provider, tenant, country FR");
    expect(() => parseAtsInventoryShadowArgs([
      "run", "--provider", "greenhouse", "--tenant", "vaulttec", "--country", "US",
      "--policy", "policy.json", "--output", "run.json", "--evidence-root", ".", "--live",
    ])).toThrow("exact provider, tenant, country FR");
  });

  test("fails closed before Greenhouse public transport can claim a complete snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      let calls = 0;
      const output = join(root, "runs", "first.json");
      await expect(runAtsInventoryShadowCli(runCommand(root, output), {
        now: () => now,
        makeRunId: () => "run-one",
        fetch: async () => {
          calls += 1;
          return greenhouseResponse("1");
        },
      })).rejects.toThrow("greenhouse public transport cannot prove complete snapshots");
      expect(calls).toBe(0);
      await expect(readFile(output, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses to seal Greenhouse artifacts that merely assert completeness", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      const firstPath = join(root, "runs", "first.json");
      const secondPath = join(root, "runs", "second.json");
      const run = (runId: string, capturedAt: string) => ({
        schemaVersion: "job-supply-shadow-run.v1", runId, provider: "greenhouse",
        tenantId: "vaulttec", countryCode: "FR", policyDigest: "a".repeat(64),
        complete: true, canonicalWritesEnabled: false, capturedAt,
        jobs: [{ externalId: "vaulttec:1", fingerprint: "b".repeat(64) }],
      });
      await Bun.write(firstPath, JSON.stringify(run("run-one", "2026-07-21T00:00:00.000Z")));
      await Bun.write(secondPath, JSON.stringify(run("run-two", "2026-07-22T00:00:00.000Z")));
      const scorecardPath = join(root, "scorecards", "sealed.json");
      const command = parseAtsInventoryShadowArgs([
        "seal", "--run", firstPath, "--run", secondPath, "--output", scorecardPath, "--evidence-root", root,
      ]);
      await expect(runAtsInventoryShadowCli(command))
        .rejects.toThrow("greenhouse public transport cannot prove complete snapshots");
      await expect(readFile(scorecardPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
