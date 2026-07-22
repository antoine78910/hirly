import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  parseAtsInventoryShadowArgs,
  runAtsInventoryShadowCli,
} from "../src/ats-inventory-shadow-cli";

const now = new Date("2026-07-21T00:00:00.000Z");
const evidenceHmacKey = "ats-shadow-evidence-test-key-material";

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
    "run",
    "--provider",
    "greenhouse",
    "--tenant",
    "vaulttec",
    "--country",
    "FR",
    "--policy",
    join(root, "policy.json"),
    "--output",
    output,
    "--evidence-root",
    root,
    "--live",
  ]);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("raw record is not JSON serializable");
  return serialized;
}
function signedRun(run: Record<string, unknown>) {
  return {
    ...run,
    signature: createHmac("sha256", evidenceHmacKey).update(canonicalJson(run)).digest("hex"),
  };
}

function greenhouseResponse(id: string) {
  return Response.json({
    jobs: [
      {
        id,
        title: "Shadow job",
        location: { name: "Paris, France" },
        absolute_url: `https://boards.greenhouse.io/vaulttec/jobs/${id}`,
        content: "Read-only shadow fixture",
      },
    ],
    meta: { total: 1 },
  });
}

describe("ATS inventory shadow CLI", () => {
  test("requires an explicit valueless --live flag and fixed run scope", () => {
    expect(() =>
      parseAtsInventoryShadowArgs([
        "run",
        "--provider",
        "greenhouse",
        "--tenant",
        "vaulttec",
        "--country",
        "FR",
        "--policy",
        "policy.json",
        "--output",
        "run.json",
        "--evidence-root",
        ".",
      ]),
    ).toThrow("--live true");
    expect(() =>
      parseAtsInventoryShadowArgs([
        "run",
        "--provider",
        "greenhouse",
        "--tenant",
        "*",
        "--country",
        "FR",
        "--policy",
        "policy.json",
        "--output",
        "run.json",
        "--evidence-root",
        ".",
        "--live",
      ]),
    ).toThrow("exact provider, tenant, country FR");
    expect(() =>
      parseAtsInventoryShadowArgs([
        "run",
        "--provider",
        "greenhouse",
        "--tenant",
        "vaulttec",
        "--country",
        "US",
        "--policy",
        "policy.json",
        "--output",
        "run.json",
        "--evidence-root",
        ".",
        "--live",
      ]),
    ).toThrow("exact provider, tenant, country FR");
  });

  test("permits and seals Greenhouse evidence only after total reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      const firstPath = join(root, "runs", "first.json");
      const secondPath = join(root, "runs", "second.json");
      await expect(
        runAtsInventoryShadowCli(runCommand(root, firstPath), {
          now: () => now,
          makeRunId: () => "run-one",
          fetch: async () => greenhouseResponse("1"),
          evidenceHmacKey,
        }),
      ).resolves.toMatchObject({ complete: true, jobs: [{ externalId: "vaulttec:1" }] });
      await expect(
        runAtsInventoryShadowCli(runCommand(root, secondPath), {
          now: () => new Date("2026-07-22T00:00:00.000Z"),
          makeRunId: () => "run-two",
          fetch: async () => greenhouseResponse("1"),
          evidenceHmacKey,
        }),
      ).resolves.toMatchObject({ complete: true });
      const scorecardPath = join(root, "scorecards", "sealed.json");
      const command = parseAtsInventoryShadowArgs([
        "seal",
        "--run",
        firstPath,
        "--run",
        secondPath,
        "--output",
        scorecardPath,
        "--evidence-root",
        root,
      ]);
      await expect(runAtsInventoryShadowCli(command, { evidenceHmacKey })).resolves.toMatchObject({
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
      await expect(
        runAtsInventoryShadowCli(runCommand(root, output), {
          now: () => now,
          makeRunId: () => "run-one",
          fetch: async () => Response.json({ jobs: [], meta: { total: 1 } }),
          evidenceHmacKey,
        }),
      ).rejects.toThrow("Greenhouse shadow response total did not reconcile");
      await expect(readFile(output, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses unsigned, forged, and tampered hand-authored run JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      const baseRun = {
        schemaVersion: "job-supply-shadow-run.v1",
        runId: "run-one",
        provider: "greenhouse",
        tenantId: "vaulttec",
        countryCode: "FR",
        policyDigest: "a".repeat(64),
        complete: true,
        canonicalWritesEnabled: false,
        capturedAt: "2026-07-21T00:00:00.000Z",
        jobs: [{ externalId: "vaulttec:1", fingerprint: "b".repeat(64) }],
      };
      const secondRun = { ...baseRun, runId: "run-two", capturedAt: "2026-07-22T00:00:00.000Z" };
      const scorecardPath = join(root, "scorecards", "sealed.json");
      await mkdir(join(root, "runs"), { recursive: true });
      const commandFor = (firstPath: string, secondPath: string) =>
        parseAtsInventoryShadowArgs([
          "seal",
          "--run",
          firstPath,
          "--run",
          secondPath,
          "--output",
          scorecardPath,
          "--evidence-root",
          root,
        ]);
      for (const [name, first] of [
        ["unsigned", baseRun],
        ["forged", { ...baseRun, signature: "0".repeat(64) }],
        [
          "tampered",
          {
            ...signedRun(baseRun),
            jobs: [{ externalId: "vaulttec:forged", fingerprint: "b".repeat(64) }],
          },
        ],
      ] as const) {
        const firstPath = join(root, `runs/${name}-first.json`);
        const secondPath = join(root, `runs/${name}-second.json`);
        await writeFile(firstPath, JSON.stringify(first));
        await writeFile(secondPath, JSON.stringify(signedRun(secondRun)));
        await expect(
          runAtsInventoryShadowCli(commandFor(firstPath, secondPath), { evidenceHmacKey }),
        ).rejects.toThrow(name === "unsigned" ? "signature" : "shadow run signature is invalid");
      }
      await expect(readFile(scorecardPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires a secure shadow evidence HMAC key", async () => {
    const root = await mkdtemp(join(tmpdir(), "ats-shadow-cli-"));
    try {
      await writeFile(join(root, "policy.json"), JSON.stringify(policy()));
      await expect(
        runAtsInventoryShadowCli(runCommand(root, join(root, "runs/first.json")), {
          evidenceHmacKey: "too-short",
        }),
      ).rejects.toThrow("ATS_SHADOW_EVIDENCE_HMAC_KEY must contain at least 32 characters");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
