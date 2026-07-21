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
    meta: { total: 1 },
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

  test("permits and seals Greenhouse evidence only after total reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      const firstPath = join(root, "runs", "first.json");
      const secondPath = join(root, "runs", "second.json");
      await expect(runAtsInventoryShadowCli(runCommand(root, firstPath), {
        now: () => now,
        makeRunId: () => "run-one",
        fetch: async () => greenhouseResponse("1"),
      })).resolves.toMatchObject({ complete: true, jobs: [{ externalId: "vaulttec:1" }] });
      await expect(runAtsInventoryShadowCli(runCommand(root, secondPath), {
        now: () => new Date("2026-07-22T00:00:00.000Z"),
        makeRunId: () => "run-two",
        fetch: async () => greenhouseResponse("1"),
      })).resolves.toMatchObject({ complete: true });
      const scorecardPath = join(root, "scorecards", "sealed.json");
      const command = parseAtsInventoryShadowArgs([
        "seal", "--run", firstPath, "--run", secondPath, "--output", scorecardPath, "--evidence-root", root,
      ]);
      await expect(runAtsInventoryShadowCli(command)).resolves.toMatchObject({
        provider: "greenhouse",
        verdict: "complete_shadow_ready",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not write evidence when Greenhouse total reconciliation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      const output = join(root, "runs", "first.json");
      await expect(runAtsInventoryShadowCli(runCommand(root, output), {
        now: () => now,
        makeRunId: () => "run-one",
        fetch: async () => Response.json({ jobs: [], meta: { total: 1 } }),
      })).rejects.toThrow("Greenhouse shadow response total did not reconcile");
      await expect(readFile(output, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
