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

  test("writes an immutable, read-only run artifact through the approved transport", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      let calls = 0;
      const output = join(root, "runs", "first.json");
      const artifact = await runAtsInventoryShadowCli(runCommand(root, output), {
        now: () => now,
        makeRunId: () => "run-one",
        fetch: async (url, init) => {
          calls += 1;
          expect(url).toBe("https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs?content=true");
          expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
          return greenhouseResponse("1");
        },
      });
      expect(calls).toBe(1);
      expect(artifact).toMatchObject({
        schemaVersion: "job-supply-shadow-run.v1",
        runId: "run-one",
        provider: "greenhouse",
        tenantId: "vaulttec",
        countryCode: "FR",
        complete: true,
        canonicalWritesEnabled: false,
        jobs: [{ externalId: "vaulttec:1" }],
      });
      await expect(runAtsInventoryShadowCli(runCommand(root, output), { now: () => now, fetch: async () => greenhouseResponse("1") }))
        .rejects.toThrow();
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(artifact);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("seals exactly two run artifacts with verifier-compatible relative SHA-256 descriptors", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      const firstPath = join(root, "runs", "first.json");
      const secondPath = join(root, "runs", "second.json");
      await runAtsInventoryShadowCli(runCommand(root, firstPath), {
        now: () => now, makeRunId: () => "run-one", fetch: async () => greenhouseResponse("1"),
      });
      await runAtsInventoryShadowCli(runCommand(root, secondPath), {
        now: () => new Date("2026-07-22T00:00:00.000Z"), makeRunId: () => "run-two", fetch: async () => greenhouseResponse("2"),
      });
      const scorecardPath = join(root, "scorecards", "sealed.json");
      const command = parseAtsInventoryShadowArgs([
        "seal", "--run", firstPath, "--run", secondPath, "--output", scorecardPath, "--evidence-root", root,
      ]);
      const scorecard = await runAtsInventoryShadowCli(command);
      if (!("runs" in scorecard)) throw new Error("seal must return a scorecard");
      expect(scorecard).toMatchObject({
        schemaVersion: 1,
        verdict: "complete_shadow_ready",
        canonicalWritesEnabled: false,
        runIds: ["run-one", "run-two"],
        runs: [{ path: "runs/first.json" }, { path: "runs/second.json" }],
      });
      for (const descriptor of scorecard.runs) {
        const bytes = await readFile(join(root, descriptor.path));
        expect(descriptor.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      }
      await expect(runAtsInventoryShadowCli(command)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
