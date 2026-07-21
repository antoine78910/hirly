import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertDisposableDatabase,
  buildReleaseVerificationPlan,
  classifyReleaseDrift,
  collectArtifactEvidence,
  collectToolEvidence,
  createReleaseAttestation,
  defaultReleaseManifestOutput,
  evaluateProviderActivationPreflight,
  executeCommand,
  findMigrationActivationStatements,
  isolatedDatabaseUrl,
  redactSensitiveText,
  resolveManifestOutput,
  sanitizedEnvironment,
  sha256,
  validateSelectedManifest,
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
      "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER",
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

  test("documents the authorized production validation separately from the side-effect-free verifier", async () => {
    const evidence = await readFile(
      join(root, "docs/operations/job-supply-production-validation-2026-07-20.md"),
      "utf8",
    );
    expect(evidence).toContain("bad5ba6de60bf6844779717369ca9df208914c33");
    expect(evidence).toContain("cddef0ef-78d4-4058-8e6e-c412d2cd8218");
    expect(evidence).toContain("dpl_9xvodCo1hPpdXyGKFaWbFmS94pyQ");
    expect(evidence).toContain("`apps/worker` was not deployed");
    expect(evidence).toContain("source tables were absent");
    expect(evidence).toContain("No provider/source activation");
    expect(evidence).toContain("read-only");
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
      await writeFile(resolve(temporaryRoot, ".omx/verification/existing.json"), "{}\n");
      expect(() => resolveManifestOutput(".omx/verification/existing.json", temporaryRoot)).toThrow(
        "must not already exist",
      );
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
    expect(workflow).toContain("sudo apt-get install -y postgresql-client zsh");
    expect(workflow).toContain("sudo apt-get install -y zsh");
    expect(workflow.match(/fetch-depth: 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflow).toContain(
      ".venv/bin/python -m pip install --disable-pip-version-check pytest==9.1.1",
    );
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

  test("derives unique append-only default manifest paths", () => {
    expect(defaultReleaseManifestOutput("20260720120000-123-deadbeef")).not.toBe(
      defaultReleaseManifestOutput("20260720120000-123-feedface"),
    );
  });

  test("selects only exact-head-bound all-passed v4 manifests", () => {
    const manifest = selectedManifest();
    expect(validateSelectedManifest(manifest)).toEqual({
      exactHead: "a".repeat(40),
      externalBlockCodes: [
        "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER",
        "SOURCE_ACTIVATION_NOT_PERFORMED",
      ],
    });
    expect(() => validateSelectedManifest({ ...manifest, version: "job-supply-release-verification.v3" })).toThrow("version");
    expect(() => validateSelectedManifest({ ...manifest, expectedHead: null })).toThrow("expectedHead");
    expect(() => validateSelectedManifest({ ...manifest, results: [{ id: "lint", status: "skipped" }] })).toThrow("lint");
    expect(() => validateSelectedManifest({
      ...manifest,
      blockedExternal: [{ code: "DATABASE_NOT_PROVIDED" }],
    })).toThrow("DATABASE_NOT_PROVIDED");
  });

  test("attests the exact selected bytes only after every external block is discharged", () => {
    const bytes = Buffer.from(`${JSON.stringify(selectedManifest())}\n`);
    const discharges = [
      discharge("REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER"),
      discharge("SOURCE_ACTIVATION_NOT_PERFORMED"),
    ];
    const attestation = createReleaseAttestation({
      manifestPath: "evidence/manifests/release.json",
      manifestBytes: bytes,
      discharges,
      deployedArtifactDigest: "b".repeat(64),
      releaseHead: "a".repeat(40),
      createdAt: "2026-07-21T00:00:00.000Z",
    });
    expect(attestation.readinessStatus).toBe("ATTESTED_READY");
    expect(attestation.selectedManifest.sha256).toBe(sha256(bytes));
    expect(() => createReleaseAttestation({
      manifestPath: "evidence/release.json", manifestBytes: bytes, discharges: discharges.slice(0, 1),
      deployedArtifactDigest: "b".repeat(64), releaseHead: "a".repeat(40),
    })).toThrow("missing");
    expect(() => createReleaseAttestation({
      manifestPath: "evidence/release.json", manifestBytes: bytes, discharges: [...discharges, discharges[0]],
      deployedArtifactDigest: "b".repeat(64), releaseHead: "a".repeat(40),
    })).toThrow("duplicate");
    expect(() => createReleaseAttestation({
      manifestPath: "evidence/release.json", manifestBytes: bytes, discharges,
      deployedArtifactDigest: "not-a-digest", releaseHead: "a".repeat(40),
    })).toThrow("SHA-256");
    expect(() => createReleaseAttestation({
      manifestPath: "evidence/release.json", manifestBytes: bytes, discharges,
      deployedArtifactDigest: "b".repeat(64), releaseHead: "c".repeat(40),
    })).toThrow("releaseHead");
  });

  test("classifies the complete release drift matrix", () => {
    expect(classifyReleaseDrift({ kind: "build_input" })).toMatchObject({
      invalidatesSelectedManifest: true, invalidatesCodeReview: true, requiresFullVerifier: true,
    });
    expect(classifyReleaseDrift({ kind: "runtime_config_outside_envelope" })).toMatchObject({
      invalidatesSelectedManifest: false, invalidatesCodeReview: false, requiresFullVerifier: false,
    });
    const buildAffected = classifyReleaseDrift({ kind: "runtime_config_outside_envelope", affectsBuildInputs: true });
    expect(buildAffected.invalidatesSelectedManifest).toBe(true);
    expect(buildAffected.invalidatesCodeReview).toBe(false);
    expect(buildAffected.requiredEvidence.filter((item) => item === "full-verifier")).toHaveLength(1);
    expect(classifyReleaseDrift({ kind: "rollout_config_inside_envelope" }).requiredEvidence).toContain("policy-expiry-check");
    expect(classifyReleaseDrift({ kind: "candidate_mandate" }).requiredEvidence).toContain("attempt-evidence");
    expect(() => classifyReleaseDrift({ kind: "unknown" })).toThrow("unknown");
  });

  test("provider activation preflight passes inventory manual and blocks each missing gate", () => {
    const input = passingManualPreflight();
    expect(evaluateProviderActivationPreflight(input)).toEqual({
      provider: "recruitee", targetVerdict: "inventory_manual", status: "PASS", failures: [],
    });
    for (const mutate of [
      (value: any) => { value.releaseAttestation = null; },
      (value: any) => { value.inventoryAccess.reviewExpiresAt = "2020-01-01T00:00:00.000Z"; },
      (value: any) => { value.killSwitches.providerArmed = false; },
      (value: any) => { value.shadowRuns.pop(); },
      (value: any) => { value.simultaneousCanonicalWriters = true; },
      (value: any) => { value.writerTransfer.throughNone = false; },
      (value: any) => { value.rollback.exercised = false; },
      (value: any) => { value.applicationAutomationEnabled = true; },
    ]) {
      const changed = structuredClone(input);
      mutate(changed);
      expect(evaluateProviderActivationPreflight(changed).status).toBe("BLOCKED");
    }
  });

  test("application activation requires current authority, privacy basis, and non-production proof", () => {
    const input = { ...passingManualPreflight(), targetVerdict: "application_canary_ready" };
    expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
    Object.assign(input, {
      submissionAuthority: approvedPolicy(),
      privacyBasis: approvedPolicy(),
      nonProductionSubmission: { status: "passed", evidence: ["evidence/non-production/attempt.json"] },
    });
    expect(evaluateProviderActivationPreflight(input).status).toBe("PASS");
  });
});

function selectedManifest() {
  return {
    version: "job-supply-release-verification.v4",
    verificationId: "20260720120000-123-deadbeef",
    overallStatus: "passed",
    exactHead: "a".repeat(40),
    expectedHead: "a".repeat(40),
    results: [{ id: "typecheck", status: "passed" }, { id: "tests", status: "passed" }],
    blockedExternal: [
      { code: "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER" },
      { code: "SOURCE_ACTIVATION_NOT_PERFORMED" },
    ],
  };
}

function discharge(code: string) {
  return { code, status: "discharged", evidence: [`evidence/${code}.json`] };
}

function approvedPolicy() {
  return {
    verdict: "approved",
    owner: "release-owner",
    evidence: ["evidence/policy.json"],
    reviewExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}

function passingManualPreflight() {
  return {
    provider: "recruitee",
    targetVerdict: "inventory_manual",
    releaseAttestation: { readinessStatus: "ATTESTED_READY" },
    inventoryAccess: approvedPolicy(),
    killSwitches: { providerArmed: true, tenantCountryArmed: true },
    rollback: {
      exercised: true,
      evidence: ["evidence/rollback.json"],
      commandTranscriptId: "rollback-transcript-123",
    },
    shadowRuns: [
      { complete: true, digestBound: true },
      { complete: true, digestBound: true },
    ],
    simultaneousCanonicalWriters: false,
    writerTransfer: { throughNone: true },
    manualDeepLink: { verified: true, evidence: ["evidence/manual-link.json"] },
    applicationAutomationEnabled: false,
  };
}
