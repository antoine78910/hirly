import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertDisposableDatabase,
  buildReleaseVerificationPlan,
  collectArtifactEvidence,
  collectToolEvidence,
  executeCommand,
  findMigrationActivationStatements,
  isolatedDatabaseUrl,
  redactSensitiveText,
  resolveManifestOutput,
  sanitizedEnvironment,
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
      verificationId: "20260720120000-123-deadbeef",
    });
    expect(plan.commands.map((entry) => entry.id)).toEqual([
      "repository-attestation",
      "frozen-install",
      "typecheck",
      "lint",
      "tests",
      "build",
      "backend-python-compatibility",
      "release-contracts",
      "stack-policy-revision",
      "deployment-default-safety",
      "diff-check",
      "legacy-frontend-frozen-install",
      "legacy-frontend-security-audit",
      "legacy-frontend-tests",
      "legacy-frontend-build",
      "worker-docker-build",
      "worker-docker-proof",
      "postgres-provision",
      "postgres-release-matrix",
      "postgres-disabled-state-proof",
    ]);
    expect(plan.commands.find((entry) => entry.id === "legacy-frontend-frozen-install")?.args).toEqual(["ci", "--legacy-peer-deps"]);
    expect(plan.commands.find((entry) => entry.id === "legacy-frontend-security-audit")?.args).toEqual([
      "audit",
      "--omit=dev",
      "--audit-level=critical",
    ]);
    expect(plan.commands.find((entry) => entry.id === "legacy-frontend-tests")?.env).toEqual({ CI: "true" });
    expect(plan.commands.find((entry) => entry.id === "backend-python-compatibility")?.args).toContain(
      "backend/tests/test_feed_db_first.py",
    );
    expect(plan.commands.find((entry) => entry.id === "postgres-release-matrix")?.redactEnvironment).toBe(true);
    expect(plan.blockedExternal.every((entry) => entry.status === "BLOCKED_EXTERNAL")).toBe(true);
    expect(plan.blockedExternal.map((entry) => entry.code)).toEqual([
      "DEPLOYMENT_NOT_PERFORMED",
      "SOURCE_ACTIVATION_NOT_PERFORMED",
    ]);
    const matrixEnv = plan.commands.find((entry) => entry.id === "postgres-release-matrix")?.env ?? {};
    expect(new Set(Object.values(matrixEnv)).size).toBe(7);
    expect(
      Object.values(matrixEnv).every((value) =>
        String(value).includes("_20260720"),
      ),
    ).toBe(true);
    expect(plan.dockerTag).toMatch(/^hirly-worker:release-verification-/);
    expect(plan.commands.find((entry) => entry.id === "worker-docker-proof")?.captureOutput).toBe(true);
  });

  test("pins an expected head in the release plan", () => {
    const plan = buildReleaseVerificationPlan({
      profile: "repository",
      expectedHead: "a".repeat(40),
      verificationId: "20260720120000-123-deadbeef",
    });
    expect(plan.expectedHead).toBe("a".repeat(40));
  });

  test("derives bounded unique database names while retaining connection credentials", () => {
    const base = `postgresql://release:super-secret@localhost/${"x".repeat(50)}_test`;
    const isolated = isolatedDatabaseUrl(base, "20260720120000_123_deadbeef_g014");
    const parsed = new URL(isolated);
    expect(decodeURIComponent(parsed.pathname.slice(1)).length).toBeLessThanOrEqual(63);
    expect(parsed.password).toBe("super-secret");
    expect(parsed.pathname).toContain("_test_");
    expect(parsed.pathname).toEndWith("_20260720120000_123_deadbeef_g014");

    const productionAudit = isolatedDatabaseUrl(
      "postgresql://release:super-secret@localhost/hirly_prod_audit_disposable",
      "20260720161314_32192_6ead51c4_g014",
    );
    expect(new URL(productionAudit).pathname).toContain("_disposable_");
    expect(() => assertDisposableDatabase(productionAudit, true)).not.toThrow();
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

  test("uses an explicit inherited environment allowlist", () => {
    const environment = sanitizedEnvironment({
      PATH: "/bin",
      HOME: "/tmp/home",
      LANG: "C",
      GITHUB_TOKEN: "must-not-leak",
      AWS_ACCESS_KEY_ID: "must-not-leak",
      CUSTOM_DATABASE_URL: "postgresql://user:password@example.test/prod",
    });
    expect(environment).toEqual({ PATH: "/bin", HOME: "/tmp/home", LANG: "C" });

    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "must-not-leak";
    try {
      const result = executeCommand({
        id: "environment-probe",
        executable: process.execPath,
        args: ["-e", "process.stdout.write(String(process.env.GITHUB_TOKEN))"],
        cwd: ".",
        env: {},
        redactEnvironment: false,
        captureOutput: true,
        evidenceKind: null,
      }, {
        stdout: () => {},
        stderr: () => {},
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("undefined");
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });

  test("contains manifest output and rejects symlink traversal", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "g015-output-"));
    try {
      await mkdir(resolve(temporaryRoot, ".omx/verification"), { recursive: true });
      expect(
        resolveManifestOutput(".omx/verification/manifest.json", temporaryRoot),
      ).toBe(resolve(temporaryRoot, ".omx/verification/manifest.json"));
      expect(() => resolveManifestOutput("../escape.json", temporaryRoot)).toThrow(
        "contained under .omx/verification",
      );
      await symlink(
        tmpdir(),
        resolve(temporaryRoot, ".omx/verification/external"),
      );
      expect(() =>
        resolveManifestOutput(
          ".omx/verification/external/manifest.json",
          temporaryRoot,
        ),
      ).toThrow("symbolic links");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("detects top-level activation while ignoring runtime function bodies", () => {
    expect(
      findMigrationActivationStatements(`
        CREATE FUNCTION claim() RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE public.worker_schedules SET enabled = true;
        END
        $$;
        INSERT INTO public.provider_registry (provider, enabled)
        VALUES ('unsafe', true);
      `),
    ).toHaveLength(1);
    expect(
      findMigrationActivationStatements(`
        INSERT INTO public.career_sources (source_key, transport_enabled)
        VALUES ('safe', false);
      `),
    ).toEqual([]);
  });

  test("hashes release tools and migration artifacts for the manifest", () => {
    const artifacts = collectArtifactEvidence(root);
    expect(artifacts.length).toBeGreaterThan(20);
    expect(artifacts.every((entry) => entry.sha256.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(artifacts.some((entry) => entry.path === "apps/worker/Dockerfile")).toBe(true);
    expect(
      artifacts.some((entry) =>
        entry.path.endsWith("20260720001100_source_trial_foundation.sql"),
      ),
    ).toBe(true);
    const tools = collectToolEvidence(
      buildReleaseVerificationPlan({
        profile: "repository",
        verificationId: "20260720120000-123-deadbeef",
      }),
    );
    expect(tools.every((tool) => tool.available && tool.sha256?.match(/^[a-f0-9]{64}$/))).toBe(true);
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
    expect(new Set(documented)).toEqual(new Set(ups));
    expect(documented).toHaveLength(ups.length);
    expect(guide).toContain(
      "not the split inventory database",
    );
    expect(guide).toContain(
      "not the separately listed application-database migrations",
    );
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
    expect(matrix).toContain("digest-sealed evidence-only CSV trial transport");
    expect(matrix).toContain("recruiter-PII redaction adapter");
    expect(matrix).toContain("catalogue membership is insufficient");
  });

  test("isolates destructive PostgreSQL suites in CI through the hardened verifier", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/typescript-foundation.yml"),
      "utf8",
    );
    expect(workflow).toContain(
      "G015_TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/hirly_test",
    );
    expect(workflow).toContain("bun run verify:job-supply-release --");
    expect(workflow).toContain("--allow-disposable-database");
    expect(workflow).toContain('--expected-head "$(git rev-parse HEAD)"');
    for (const sharedSuiteVariable of [
      "G002_TEST_DATABASE_URL:",
      "G003_TEST_DATABASE_URL:",
      "G004_TEST_DATABASE_URL:",
      "G010_TEST_DATABASE_URL:",
      "G011_TEST_DATABASE_URL:",
      "JOB_INGESTION_LEDGER_TEST_DATABASE_URL:",
      "G014_TEST_DATABASE_URL:",
    ]) {
      expect(workflow).not.toContain(sharedSuiteVariable);
    }
  });

  test("documents all current evidence-only trial surfaces without implying activation", async () => {
    const runbook = await readFile(
      resolve(root, "docs/operations/job-source-shadow-trial.md"),
      "utf8",
    );
    for (const source of [
      "Greenhouse",
      "Lever",
      "Choisir le Service Public",
      "Qualified data.gouv resource",
      "BPCE via data.gouv",
      "Ashby",
    ]) {
      expect(runbook).toContain(source);
    }
    expect(runbook).toContain("qualified_evidence_only");
    expect(runbook).toContain("BLOCKED_EXTERNAL");
    expect(runbook).toContain("production readiness or canonical writer");
  });
});
