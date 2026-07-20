import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertDisposableDatabase,
  buildReleaseVerificationPlan,
  executeCommand,
  redactSensitiveText,
  verifyDeploymentDefaults,
} from "../scripts/verify-job-supply-release.mjs";

const root = resolve(import.meta.dir, "..");

describe("G015 release verification contract", () => {
  test("requires explicit opt-in and a local disposable database", () => {
    const safe = "postgresql://release:super-secret@localhost/hirly_release_test";
    expect(() => assertDisposableDatabase(safe, false)).toThrow("--allow-disposable-database");
    expect(() => assertDisposableDatabase("postgresql://u:p@db.example.com/hirly_test", true)).toThrow("loopback");
    expect(() => assertDisposableDatabase("postgresql://u:p@localhost/hirly", true)).toThrow("test or disposable");
    expect(() => assertDisposableDatabase(safe, true)).not.toThrow();
  });

  test("builds deterministic checks with reproducible installs and typed blockers", () => {
    const databaseUrl = "postgresql://release:super-secret@localhost/hirly_release_test";
    const plan = buildReleaseVerificationPlan({
      profile: "full",
      databaseUrl,
      allowDisposableDatabase: true,
    });
    expect(plan.commands.map((entry) => entry.id)).toEqual([
      "repository-attestation",
      "frozen-install",
      "typecheck",
      "lint",
      "tests",
      "build",
      "release-contracts",
      "stack-policy-revision",
      "deployment-default-safety",
      "diff-check",
      "legacy-frontend-frozen-install",
      "legacy-frontend-build",
      "worker-docker-build",
      "postgres-release-matrix",
    ]);
    expect(plan.commands.find((entry) => entry.id === "legacy-frontend-frozen-install")?.args).toEqual(["ci", "--legacy-peer-deps"]);
    expect(plan.commands.find((entry) => entry.id === "postgres-release-matrix")?.redactEnvironment).toBe(true);
    expect(plan.blockedExternal.every((entry) => entry.status === "BLOCKED_EXTERNAL")).toBe(true);
    expect(plan.blockedExternal.map((entry) => entry.code)).toEqual([
      "DEPLOYMENT_NOT_PERFORMED",
      "SOURCE_ACTIVATION_NOT_PERFORMED",
    ]);
  });

  test("redacts credentials emitted by an actual child process", () => {
    const databaseUrl = "postgresql://release:super-secret@localhost/hirly_release_test";
    let output = "";
    const result = executeCommand(
      {
        id: "redaction-probe",
        executable: process.execPath,
        args: ["-e", "console.log(process.env.PROBE_DATABASE_URL); console.error('password=super-secret')"],
        cwd: ".",
        env: { PROBE_DATABASE_URL: databaseUrl },
        redactEnvironment: true,
      },
      {
        stdout: (value: string) => { output += value; },
        stderr: (value: string) => { output += value; },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("super-secret");
    expect(result.stderr).not.toContain("super-secret");
    expect(output).not.toContain(databaseUrl);
    expect(output).not.toContain("super-secret");
    expect(output).toContain("[REDACTED]");
    expect(redactSensitiveText(`password=super-secret`, [databaseUrl])).not.toContain("super-secret");
  });

  test("executes deployment and disabled-default safety assertions", () => {
    const result = verifyDeploymentDefaults(root);
    expect(result.migrations.length).toBeGreaterThan(0);
    expect(result.workerDockerValidated).toBe(true);
    expect(result.backendRailwayValidated).toBe(true);
  });

  test("documents every migration in exact application order with matching down coverage", async () => {
    const allFiles = await readdir(resolve(root, "backend/db/migrations"));
    const ups = allFiles
      .filter((name) => /^20260720\d+_.+\.sql$/.test(name))
      .filter((name) => !name.endsWith(".down.sql"))
      .sort();
    const downs = new Set(allFiles.filter((name) => name.endsWith(".down.sql")));
    expect(ups.every((name) => downs.has(name.replace(/\.sql$/, ".down.sql")))).toBe(true);

    const guide = await readFile(resolve(root, "docs/operations/job-supply-release-readiness.md"), "utf8");
    const documented = [...guide.matchAll(/^\d+\. `([^`]+\.sql)`$/gm)].map((match) => match[1]);
    expect(documented).toEqual(ups);
    expect(guide.toLowerCase()).toContain("reverse order");
    expect(guide.toLowerCase()).toContain("operational rollback");
    expect(guide.toLowerCase()).toContain("destructive rollback");
  });

  test("publishes one consolidated source readiness matrix", async () => {
    const matrix = await readFile(resolve(root, "docs/operations/job-source-readiness-matrix.md"), "utf8");
    for (const source of [
      "France Travail", "Greenhouse", "Lever", "Ashby",
      "Choisir le Service Public", "BPCE", "Apec",
      "La Bonne Alternance", "Bright Data",
    ]) expect(matrix).toContain(source);
    expect(matrix).toContain("Trial ready");
    expect(matrix).toContain("Production ready");
    expect(matrix).toContain("Canonical writer");
  });
});
