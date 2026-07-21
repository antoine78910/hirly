import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertDisposableDatabase,
  buildReleaseVerificationPlan,
  classifyReleaseDrift,
  collectArtifactEvidence,
  collectToolEvidence,
  createAtsPhase0Receipt,
  createReleaseAttestation,
  defaultAtsPhase0ReceiptOutput,
  defaultReleaseManifestOutput,
  evaluateProviderActivationPreflight as evaluateProviderActivationPreflightRaw,
  executeCommand,
  findMigrationActivationStatements,
  isolatedDatabaseUrl,
  redactSensitiveText,
  resolveManifestOutput,
  sanitizedEnvironment,
  sha256,
  signActivationEvidenceRecord,
  validateSelectedManifest,
  verifyDeploymentDefaults,
} from "../scripts/verify-job-supply-release.mjs";

const root = resolve(import.meta.dir, "..");
const ACTIVATION_HMAC_KEY = "g015-test-only-activation-attestation-key-material";
const ACTIVATION_ISSUER = "github-actions";
const ACTIVATION_WORKFLOW_ID = "job-supply-release";
const ACTIVATION_WORKFLOW_RUN_ID = "20260721.1";
let activationEvidenceSequence = 0;

function evaluateProviderActivationPreflight(input: any) {
  return evaluateProviderActivationPreflightRaw(input, {
    evidenceRoot: input.evidenceRoot,
    trustedAttestationKey: ACTIVATION_HMAC_KEY,
    trustedAttestationIssuer: ACTIVATION_ISSUER,
    trustedWorkflowId: ACTIVATION_WORKFLOW_ID,
    trustedWorkflowRunId: ACTIVATION_WORKFLOW_RUN_ID,
  });
}

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
      "--audit-level=high",
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

  test("reserves Vercel production deployment ownership for the staged workflow", async () => {
    const rootConfig = JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));
    const frontendConfig = JSON.parse(await readFile(resolve(root, "frontend/vercel.json"), "utf8"));
    expect(rootConfig.git?.deploymentEnabled).toBe(false);
    expect(frontendConfig.git?.deploymentEnabled).toBe(false);
    expect(() => verifyDeploymentDefaults(root)).not.toThrow();
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
    expect(() => validateSelectedManifest({ ...manifest, profile: "repository" })).toThrow("profile");
    expect(() => validateSelectedManifest({ ...manifest, results: manifest.results.slice(1) })).toThrow("missing");
    expect(() => validateSelectedManifest({ ...manifest, results: [...manifest.results, manifest.results[0]] })).toThrow("unique");
    expect(() => validateSelectedManifest({
      ...manifest,
      results: [...manifest.results, { id: "arbitrary-extra", status: "passed" }],
    })).toThrow("extra");
    expect(() => validateSelectedManifest({
      ...manifest,
      results: manifest.results.map((result) => result.id === "lint" ? { ...result, status: "skipped" } : result),
    })).toThrow("lint");
    expect(() => validateSelectedManifest({
      ...manifest,
      blockedExternal: [{ code: "DATABASE_NOT_PROVIDED" }],
    })).toThrow("DATABASE_NOT_PROVIDED");
    expect(() => validateSelectedManifest({ ...manifest, blockedExternal: [] })).toThrow("mandatory");
  });

  test("attests contained sealed evidence only after every exact external block is discharged", async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-attestation-"));
    const selectedManifestDescriptor = await writeEvidence(evidenceRoot, "manifest.json", selectedManifest());
    const discharges = await Promise.all(EXTERNAL_BLOCKS.map((code) => writeDischarge(evidenceRoot, code)));
    const attestation = createReleaseAttestation({
      selectedManifest: selectedManifestDescriptor,
      discharges,
      deployedArtifactDigest: "b".repeat(64),
      releaseHead: "a".repeat(40),
      createdAt: "2026-07-21T00:00:00.000Z",
      evidenceRoot,
    });
    expect(attestation.readinessStatus).toBe("ATTESTED_READY");
    expect(attestation.selectedManifest).toEqual(selectedManifestDescriptor);
    expect(() => createReleaseAttestation({
      selectedManifest: selectedManifestDescriptor, discharges: discharges.slice(0, 1), evidenceRoot,
      deployedArtifactDigest: "b".repeat(64), releaseHead: "a".repeat(40),
    })).toThrow("missing");
    expect(() => createReleaseAttestation({
      selectedManifest: selectedManifestDescriptor, discharges: [...discharges, discharges[0]], evidenceRoot,
      deployedArtifactDigest: "b".repeat(64), releaseHead: "a".repeat(40),
    })).toThrow("duplicate");
    expect(() => createReleaseAttestation({
      selectedManifest: selectedManifestDescriptor, discharges, evidenceRoot,
      deployedArtifactDigest: "not-a-digest", releaseHead: "a".repeat(40),
    })).toThrow("SHA-256");
    expect(() => createReleaseAttestation({
      selectedManifest: selectedManifestDescriptor, discharges, evidenceRoot,
      deployedArtifactDigest: "b".repeat(64), releaseHead: "c".repeat(40),
    })).toThrow("releaseHead");
    expect(() => createReleaseAttestation({
      selectedManifest: { ...selectedManifestDescriptor, path: "../manifest.json" }, discharges, evidenceRoot,
      deployedArtifactDigest: "b".repeat(64), releaseHead: "a".repeat(40),
    })).toThrow("contained");
    await rm(evidenceRoot, { recursive: true, force: true });
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

  test("provider activation preflight passes sealed inventory manual evidence and blocks bypasses", async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-preflight-"));
    const input = await passingManualPreflight(evidenceRoot);
    expect(evaluateProviderActivationPreflight(input)).toEqual({
      provider: "recruitee", targetVerdict: "inventory_manual", status: "PASS", failures: [],
    });
    for (const mutate of [
      (value: any) => { value.releaseAttestation = null; },
      (value: any) => { value.inventoryAccess.reviewExpiresAt = "2020-01-01T00:00:00.000Z"; },
      (value: any) => { value.killSwitches.providerArmed = false; },
      (value: any) => { value.shadowScorecard.path = "../escape.json"; },
      (value: any) => { value.shadowScorecard.path = "missing.json"; },
      (value: any) => { value.writerOwnership.path = "missing.json"; },
      (value: any) => { value.rollback.exercised = false; },
      (value: any) => { value.applicationAutomationEnabled = true; },
    ]) {
      const changed = structuredClone(input);
      mutate(changed);
      expect(evaluateProviderActivationPreflight(changed).status).toBe("BLOCKED");
    }
    expect(evaluateProviderActivationPreflight({ ...input, provider: "unregistered-evil" }).status)
      .toBe("BLOCKED");
    for (const targetVerdict of ["inventory_canary_ready", "inventory_active", "application_canary_ready", "application_active"]) {
      expect(evaluateProviderActivationPreflight({ ...input, targetVerdict }).status).toBe("BLOCKED");
      const nicoka = { ...input, provider: "nicoka", targetVerdict };
      expect(evaluateProviderActivationPreflight(nicoka).status).toBe("BLOCKED");
    }
    await writeFile(resolve(evidenceRoot, input.shadowScorecard.path), "tampered\n");
    expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  test("enforces the complete inventory lifecycle for every supported inventory provider", async () => {
    for (const provider of ["greenhouse", "recruitee", "nicoka"]) {
      for (const step of [
        { currentVerdict: "blocked", targetVerdict: "inventory_canary_ready", gates: ["prior_state_receipt", "review", "ultraqa"] },
        { currentVerdict: "inventory_canary_ready", targetVerdict: "inventory_active", gates: ["canary_receipt", "observation", "review", "ultraqa"] },
        { currentVerdict: "inventory_active", targetVerdict: "inventory_manual", gates: ["prior_state_receipt", "review", "ultraqa"] },
      ] as const) {
        const evidenceRoot = await mkdtemp(join(tmpdir(), `g015-${provider}-lifecycle-`));
        const input = await passingManualPreflight(evidenceRoot, provider);
        const scope = {
          provider, tenantId: input.tenantId, countryCode: input.countryCode,
          policyDigest: input.policyDigest, releaseHead: "a".repeat(40),
          deployedArtifactDigest: "b".repeat(64),
        };
        Object.assign(input, step, {
          transitionEvidence: await writeTransitionEvidence(evidenceRoot, step.targetVerdict, step.gates, scope),
        });
        const { deployedArtifactDigest: _artifactDigest, ...writerScope } = scope;
        input.writerOwnership = await writeEvidence(evidenceRoot, `ownership/${provider}-${step.targetVerdict}.json`, {
          schemaVersion: "job-supply-writer-ownership.v1", status: "observed", ...writerScope,
          previousWriterRuntime: step.currentVerdict === "blocked" ? "none" : "typescript",
          writerRuntime: "typescript", throughNone: step.currentVerdict === "blocked",
          simultaneousCanonicalWriters: false, ownershipEpoch: 5,
          observedAt: "2026-07-21T00:00:00.000Z",
        });
        expect(evaluateProviderActivationPreflight(input)).toMatchObject({ status: "PASS", failures: [] });
        const skipped = structuredClone(input);
        skipped.currentVerdict = "blocked";
        if (step.targetVerdict !== "inventory_canary_ready") {
          expect(evaluateProviderActivationPreflight(skipped).status).toBe("BLOCKED");
        }
        await rm(evidenceRoot, { recursive: true, force: true });
      }
    }
  });

  test("validates exact shadow scorecard scope, reconciliation, run IDs, and inner digest", async () => {
    for (const mutate of [
      (value: any) => { value.provider = "nicoka"; },
      (value: any) => { value.tenantId = "other"; },
      (value: any) => { value.countryCode = "US"; },
      (value: any) => { value.runIds[1] = value.runIds[0]; },
      (value: any) => { value.runs = value.runs.slice(0, 1); },
      (value: any) => { value.reconciliation = []; },
      (value: any) => { value.reconciliation[0].fromRunId = "wrong"; },
      (value: any) => { value.evidenceDigest = "0".repeat(64); },
    ]) {
      const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-scorecard-"));
      const input = await passingManualPreflight(evidenceRoot);
      const scorecard = JSON.parse(await readFile(resolve(evidenceRoot, input.shadowScorecard.path), "utf8"));
      mutate(scorecard);
      input.shadowScorecard = await writeEvidence(evidenceRoot, "shadow-mutated.json", scorecard);
      expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  });

  test("re-reads both sealed shadow runs and sealed writer ownership evidence", async () => {
    for (const mutate of [
      async (root: string, input: any) => {
        const scorecard = JSON.parse(await readFile(resolve(root, input.shadowScorecard.path), "utf8"));
        await writeFile(resolve(root, scorecard.runs[0].path), "tampered\n");
      },
      async (_root: string, input: any) => { input.writerOwnership.sha256 = "0".repeat(64); },
    ]) {
      const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-underlying-"));
      const input = await passingManualPreflight(evidenceRoot);
      await mutate(evidenceRoot, input);
      expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  });

  test("re-reads manifest and every exact discharge during provider preflight", async () => {
    for (const mutate of [
      async (root: string, input: any) => {
        const attestation = JSON.parse(await readFile(resolve(root, input.releaseAttestation.path), "utf8"));
        await writeFile(resolve(root, attestation.selectedManifest.path), "tampered\n");
      },
      async (root: string, input: any) => {
        const attestation = JSON.parse(await readFile(resolve(root, input.releaseAttestation.path), "utf8"));
        attestation.externalBlockDischarges.pop();
        input.releaseAttestation = await writeEvidence(root, "release/attestation-missing.json", attestation);
      },
      async (root: string, input: any) => {
        const attestation = JSON.parse(await readFile(resolve(root, input.releaseAttestation.path), "utf8"));
        attestation.externalBlockDischarges[1] = attestation.externalBlockDischarges[0];
        input.releaseAttestation = await writeEvidence(root, "release/attestation-duplicate.json", attestation);
      },
      async (root: string, input: any) => {
        const attestation = JSON.parse(await readFile(resolve(root, input.releaseAttestation.path), "utf8"));
        attestation.externalBlockDischarges[0] = await writeDischarge(root, EXTERNAL_BLOCKS[0], { releaseHead: "c".repeat(40), path: "mismatch.json" });
        input.releaseAttestation = await writeEvidence(root, "release/attestation-mismatch.json", attestation);
      },
    ]) {
      const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-sealed-release-"));
      const input = await passingManualPreflight(evidenceRoot);
      await mutate(evidenceRoot, input);
      expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  });

  test("greenhouse application requires reviewed hosted-form capability evidence", async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-greenhouse-"));
    const input = {
      ...(await passingManualPreflight(evidenceRoot, "greenhouse")),
      currentVerdict: "inventory_active",
      targetVerdict: "application_canary_ready",
    };
    const scope = {
      provider: input.provider,
      tenantId: input.tenantId,
      countryCode: input.countryCode,
      policyDigest: input.policyDigest,
      releaseHead: "a".repeat(40),
    };
    input.writerOwnership = await writeEvidence(evidenceRoot, "ownership/greenhouse-active.json", {
      schemaVersion: "job-supply-writer-ownership.v1", status: "observed", ...scope,
      previousWriterRuntime: "typescript", writerRuntime: "typescript", throughNone: false,
      simultaneousCanonicalWriters: false, ownershipEpoch: 5,
      observedAt: "2026-07-21T00:00:00.000Z",
    });
    input.transitionEvidence = await writeTransitionEvidence(
      evidenceRoot,
      input.targetVerdict,
      ["prior_state_receipt", "review", "ultraqa"],
      scope,
    );
    Object.assign(input, {
      submissionAuthority: approvedPolicy(await writeActivationEvidence(evidenceRoot, "submissionAuthority_policy", scope)),
      privacyBasis: approvedPolicy(await writeActivationEvidence(evidenceRoot, "privacyBasis_policy", scope)),
      nonProductionSubmission: {
        status: "passed",
        evidence: await writeActivationEvidence(evidenceRoot, "non_production_submission", scope),
      },
    });
    expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
    input.applicationCapability = {
      reviewed: true,
      transport: "hosted_candidate_form",
      evidence: await writeActivationEvidence(evidenceRoot, "application_capability_review", scope),
    };
    expect(evaluateProviderActivationPreflight(input).status).toBe("PASS");
    for (const applicationCapability of [
      { ...input.applicationCapability, reviewed: false },
      { ...input.applicationCapability, transport: "api" },
      { ...input.applicationCapability, evidence: null },
    ]) expect(evaluateProviderActivationPreflight({ ...input, applicationCapability }).status).toBe("BLOCKED");
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  test("blocks skipped active transitions and requires sealed canary, observation, review, and UltraQA gates", async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-state-machine-"));
    const input = {
      ...(await passingManualPreflight(evidenceRoot, "greenhouse")),
      currentVerdict: "inventory_canary_ready",
      targetVerdict: "inventory_active",
    };
    const scope = {
      provider: input.provider,
      tenantId: input.tenantId,
      countryCode: input.countryCode,
      policyDigest: input.policyDigest,
      releaseHead: "a".repeat(40),
    };
    input.writerOwnership = await writeEvidence(evidenceRoot, "ownership/greenhouse-inventory-active.json", {
      schemaVersion: "job-supply-writer-ownership.v1", status: "observed", ...scope,
      previousWriterRuntime: "typescript", writerRuntime: "typescript", throughNone: false,
      simultaneousCanonicalWriters: false, ownershipEpoch: 5,
      observedAt: "2026-07-21T00:00:00.000Z",
    });
    input.transitionEvidence = await writeTransitionEvidence(
      evidenceRoot,
      input.targetVerdict,
      ["canary_receipt", "observation", "review", "ultraqa"],
      scope,
    );
    expect(evaluateProviderActivationPreflight(input).status).toBe("PASS");

    for (const mutate of [
      (value: any) => { value.currentVerdict = "inventory_manual"; },
      (value: any) => { delete value.transitionEvidence.canary_receipt; },
      (value: any) => { delete value.transitionEvidence.observation; },
      (value: any) => { delete value.transitionEvidence.review; },
      (value: any) => { delete value.transitionEvidence.ultraqa; },
      (value: any) => { value.transitionEvidence.unreviewed = value.transitionEvidence.review; },
      (value: any) => { value.transitionEvidence.review.sha256 = "0".repeat(64); },
    ]) {
      const changed = structuredClone(input);
      mutate(changed);
      expect(evaluateProviderActivationPreflight(changed).status).toBe("BLOCKED");
    }
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  test("rejects forged, stale, future, replayed, or artifact-mismatched activation attestations", async () => {
    const mutations = [
      async (_root: string, input: any) => {
        input.transitionEvidence.review.signature = "0".repeat(64);
      },
      async (root: string, input: any) => {
        const descriptor = input.transitionEvidence.review;
        const envelope = JSON.parse(await readFile(resolve(root, descriptor.path), "utf8"));
        envelope.review.security.verdict = "CLEAN";
        envelope.review.security.unresolvedFindings = 1;
        envelope.signature = signActivationEvidenceRecord(envelope, ACTIVATION_HMAC_KEY);
        input.transitionEvidence.review = await writeEvidence(root, "activation/forged-review.json", envelope);
      },
      async (root: string, input: any) => {
        const descriptor = input.transitionEvidence.ultraqa;
        const envelope = JSON.parse(await readFile(resolve(root, descriptor.path), "utf8"));
        envelope.ultraqa.status = "failed";
        envelope.signature = signActivationEvidenceRecord(envelope, ACTIVATION_HMAC_KEY);
        input.transitionEvidence.ultraqa = await writeEvidence(root, "activation/failed-ultraqa.json", envelope);
      },
      async (root: string, input: any) => {
        const descriptor = input.transitionEvidence.review;
        const envelope = JSON.parse(await readFile(resolve(root, descriptor.path), "utf8"));
        envelope.observedAt = "2026-07-22T00:00:00.000Z";
        envelope.signature = signActivationEvidenceRecord(envelope, ACTIVATION_HMAC_KEY);
        input.transitionEvidence.review = await writeEvidence(root, "activation/future-review.json", envelope);
      },
      async (root: string, input: any) => {
        const descriptor = input.transitionEvidence.review;
        const envelope = JSON.parse(await readFile(resolve(root, descriptor.path), "utf8"));
        envelope.observedAt = "2026-07-19T00:00:00.000Z";
        envelope.signature = signActivationEvidenceRecord(envelope, ACTIVATION_HMAC_KEY);
        input.transitionEvidence.review = await writeEvidence(root, "activation/stale-review.json", envelope);
      },
      async (root: string, input: any) => {
        const review = JSON.parse(await readFile(resolve(root, input.transitionEvidence.review.path), "utf8"));
        const ultraqa = JSON.parse(await readFile(resolve(root, input.transitionEvidence.ultraqa.path), "utf8"));
        ultraqa.evidenceId = review.evidenceId;
        ultraqa.signature = signActivationEvidenceRecord(ultraqa, ACTIVATION_HMAC_KEY);
        input.transitionEvidence.ultraqa = await writeEvidence(root, "activation/replayed-ultraqa.json", ultraqa);
      },
      async (root: string, input: any) => {
        const scope = {
          provider: input.provider, tenantId: input.tenantId, countryCode: input.countryCode,
          policyDigest: input.policyDigest, releaseHead: "a".repeat(40),
          deployedArtifactDigest: "c".repeat(64),
        };
        input.transitionEvidence.review = await writeActivationEvidence(
          root,
          "inventory_manual_review",
          scope,
        );
      },
    ];
    for (const mutate of mutations) {
      const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-hostile-attestation-"));
      const input = await passingManualPreflight(evidenceRoot);
      input.now = "2026-07-21T01:00:00.000Z";
      await mutate(evidenceRoot, input);
      expect(evaluateProviderActivationPreflight(input).status).toBe("BLOCKED");
      await rm(evidenceRoot, { recursive: true, force: true });
    }
    const evidenceRoot = await mkdtemp(join(tmpdir(), "g015-missing-trust-"));
    const input = await passingManualPreflight(evidenceRoot);
    expect(evaluateProviderActivationPreflightRaw(input, { evidenceRoot }).status).toBe("BLOCKED");
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  test("creates secret-free Phase 0 receipts and blocks unobserved remote evidence", () => {
    const input = phase0Input();
    const receipt = createAtsPhase0Receipt(input, {
      verificationId: "20260721120000-321-deadbeef",
      createdAt: "2026-07-21T12:00:00.000Z",
    });
    expect(receipt.version).toBe("ats-phase0-receipt.v1");
    expect(receipt.readinessStatus).toBe("BLOCKED_EXTERNAL");
    expect(receipt.observations.deployedArtifact.status).toBe("BLOCKED_EXTERNAL");
    expect(receipt.canonicalInputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(defaultAtsPhase0ReceiptOutput(receipt.verificationId)).toContain(receipt.verificationId);
    expect(JSON.stringify(receipt)).not.toContain("secret-canary");
    expect(() => createAtsPhase0Receipt({ ...input, apiToken: "secret-canary" })).toThrow("secret-shaped");
    expect(() => createAtsPhase0Receipt({ ...input, unknownField: true })).toThrow("unknown fields");
    expect(() => createAtsPhase0Receipt({ ...input, workingTreeStatus: "maybe-clean" })).toThrow("workingTreeStatus");
    expect(() => createAtsPhase0Receipt({ ...input, migrationLedger: [{ id: "bad", status: "observed" }] })).toThrow("migrationLedger");
    expect(() => createAtsPhase0Receipt({ ...input, providerOwnership: [{ provider: "evil", writerRuntime: "node" }] })).toThrow("providerOwnership");
    expect(() => createAtsPhase0Receipt({ ...input, rollbackCommands: [{ id: "!", evidence: "" }] })).toThrow("rollbackCommands");
    expect(() => createAtsPhase0Receipt({ ...input, policies: { ...input.policies, unexpected: approvedPolicy() } })).toThrow("unknown fields");
    for (const key of ["authorization", "cookie", "credential", "apiKey"]) {
      expect(() => createAtsPhase0Receipt({ ...input, deployedRuntime: { [key]: "redacted" } })).toThrow("secret-shaped");
    }
    for (const value of ["Bearer abc", "Basic YWJj", "https://user:pass@example.com/path"]) {
      expect(() => createAtsPhase0Receipt({ ...input, deployedRuntime: { status: value } })).toThrow();
    }
    for (const value of [
      "password=secret-canary",
      "token:secret-canary",
      "api_key=secret-canary",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.signature",
      "-----BEGIN PRIVATE KEY-----\nsecret-canary\n-----END PRIVATE KEY-----",
    ]) {
      expect(() => createAtsPhase0Receipt({ ...input, deployedRuntime: { status: value } }))
        .toThrow("secret-pattern");
    }
    expect(() => createAtsPhase0Receipt({
      ...input,
      databaseMigrationState: { connection: "postgresql://user:secret-canary@localhost/prod" },
    })).toThrow("connection URL");
    expect(() => createAtsPhase0Receipt({
      ...input,
      environmentFlags: [{ name: "WORKER_CONTROL_ENABLED", state: "redacted", value: "true" }],
    })).toThrow("redacted states only");
  });
});

function selectedManifest() {
  return {
    version: "job-supply-release-verification.v4",
    verificationId: "20260720120000-123-deadbeef",
    profile: "full",
    overallStatus: "passed",
    exactHead: "a".repeat(40),
    expectedHead: "a".repeat(40),
    results: [
      "repository-attestation", "frozen-install", "typecheck", "lint", "tests", "build",
      "backend-python-compatibility", "release-contracts", "stack-policy-revision",
      "deployment-default-safety", "diff-check", "legacy-frontend-frozen-install",
      "legacy-frontend-security-audit", "legacy-frontend-tests", "legacy-frontend-build",
      "worker-docker-build", "worker-docker-proof", "postgres-provision",
      "postgres-release-matrix", "postgres-disabled-state-proof",
    ].map((id) => ({ id, status: "passed" })),
    blockedExternal: [
      { code: "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER" },
      { code: "SOURCE_ACTIVATION_NOT_PERFORMED" },
    ],
  };
}

const EXTERNAL_BLOCKS = [
  "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER",
  "SOURCE_ACTIVATION_NOT_PERFORMED",
];

async function writeEvidence(evidenceRoot: string, path: string, json: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(json)}\n`);
  await mkdir(dirname(resolve(evidenceRoot, path)), { recursive: true });
  await writeFile(resolve(evidenceRoot, path), bytes);
  return { path, sha256: sha256(bytes) };
}

async function writeDischarge(
  evidenceRoot: string,
  code: string,
  overrides: { releaseHead?: string; deployedArtifactDigest?: string; path?: string } = {},
) {
  return writeEvidence(evidenceRoot, overrides.path ?? `discharges/${code}.json`, {
    version: "job-supply-external-discharge.v1",
    code,
    status: "discharged",
    releaseHead: overrides.releaseHead ?? "a".repeat(40),
    deployedArtifactDigest: overrides.deployedArtifactDigest ?? "b".repeat(64),
    observedAt: "2026-07-21T00:00:00.000Z",
  });
}

function approvedPolicy(evidence: unknown = ["evidence/policy.json"]) {
  return {
    verdict: "approved",
    owner: "release-owner",
    evidence,
    reviewExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}

async function writeActivationEvidence(
  evidenceRoot: string,
  kind: string,
  scope: {
    provider: string;
    tenantId: string;
    countryCode: string;
    policyDigest: string;
    releaseHead: string;
    deployedArtifactDigest?: string;
  },
  semanticOverrides: Record<string, unknown> = {},
) {
  const semantics = kind.endsWith("_review")
    ? {
        review: {
          security: { verdict: "CLEAN", unresolvedFindings: 0 },
          codeReview: { verdict: "APPROVE" },
          architecture: { verdict: "CLEAR" },
        },
      }
    : kind.endsWith("_ultraqa")
      ? { ultraqa: { status: "passed" } }
      : {};
  const provenance = () => ({
    issuer: ACTIVATION_ISSUER,
    workflowId: ACTIVATION_WORKFLOW_ID,
    workflowRunId: ACTIVATION_WORKFLOW_RUN_ID,
    evidenceId: `g015-${++activationEvidenceSequence}-${kind}`,
    observedAt: "2026-07-21T00:00:00.000Z",
  });
  const unsignedArtifact = {
    kind,
    result: "passed",
    releaseHead: scope.releaseHead,
    deployedArtifactDigest: scope.deployedArtifactDigest ?? "b".repeat(64),
    ...provenance(),
    ...semantics,
  };
  const artifact = await writeEvidence(
    evidenceRoot,
    `activation/artifacts/${kind}.json`,
    { ...unsignedArtifact, signature: signActivationEvidenceRecord(unsignedArtifact, ACTIVATION_HMAC_KEY) },
  );
  const unsignedEnvelope = {
    schemaVersion: "job-supply-activation-evidence.v1",
    kind,
    status: "passed",
    ...scope,
    deployedArtifactDigest: scope.deployedArtifactDigest ?? "b".repeat(64),
    ...provenance(),
    artifacts: [artifact],
    ...semantics,
    ...semanticOverrides,
  };
  return writeEvidence(evidenceRoot, `activation/${kind}.json`, {
    ...unsignedEnvelope,
    signature: signActivationEvidenceRecord(unsignedEnvelope, ACTIVATION_HMAC_KEY),
  });
}

async function writeTransitionEvidence(
  evidenceRoot: string,
  targetVerdict: string,
  gates: readonly string[],
  scope: { provider: string; tenantId: string; countryCode: string; policyDigest: string; releaseHead: string },
) {
  return Object.fromEntries(await Promise.all(gates.map(async (gate) => [
    gate,
    await writeActivationEvidence(evidenceRoot, `${targetVerdict}_${gate}`, scope),
  ])));
}

async function passingManualPreflight(evidenceRoot: string, provider = "recruitee") {
  const policyDigest = "c".repeat(64);
  const selectedManifestDescriptor = await writeEvidence(evidenceRoot, "release/manifest.json", selectedManifest());
  const discharges = await Promise.all(EXTERNAL_BLOCKS.map((code) => writeDischarge(evidenceRoot, code)));
  const releaseAttestation = createReleaseAttestation({
    selectedManifest: selectedManifestDescriptor,
    discharges,
    deployedArtifactDigest: "b".repeat(64),
    releaseHead: "a".repeat(40),
    createdAt: "2026-07-21T00:00:00.000Z",
    evidenceRoot,
  });
  const releaseAttestationDescriptor = await writeEvidence(
    evidenceRoot,
    "release/attestation.json",
    releaseAttestation,
  );
  const scope = {
    provider,
    tenantId: "vaulttec",
    countryCode: "FR",
    policyDigest,
    releaseHead: releaseAttestation.releaseHead,
  };
  const runs = await Promise.all(["shadow-1", "shadow-2"].map((runId, index) => writeEvidence(
    evidenceRoot,
    `shadow/${runId}.json`,
    {
      schemaVersion: "job-supply-shadow-run.v1",
      runId,
      provider,
      tenantId: "vaulttec",
      countryCode: "FR",
      policyDigest,
      complete: true,
      canonicalWritesEnabled: false,
      capturedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
      jobs: [{ externalId: `job-${index + 1}`, fingerprint: `${index + 1}` }],
    },
  )));
  const shadowEvidence = {
    schemaVersion: 1,
    verdict: "complete_shadow_ready",
    canonicalWritesEnabled: false,
    provider,
    tenantId: "vaulttec",
    countryCode: "FR",
    policyDigest,
    runIds: ["shadow-1", "shadow-2"],
    runs,
    reconciliation: [{
      fromRunId: "shadow-1", toRunId: "shadow-2", additions: [], updates: ["job-1"], removals: [],
    }],
  };
  const shadowScorecard = { ...shadowEvidence, evidenceDigest: sha256(canonicalTestJson(shadowEvidence)) };
  const writerOwnership = await writeEvidence(evidenceRoot, "ownership/recruitee.json", {
    schemaVersion: "job-supply-writer-ownership.v1",
    status: "observed",
    ...scope,
    previousWriterRuntime: "typescript",
    writerRuntime: "typescript",
    throughNone: false,
    simultaneousCanonicalWriters: false,
    ownershipEpoch: 4,
    observedAt: "2026-07-21T00:00:00.000Z",
  });
  return {
    evidenceRoot,
    provider,
    currentVerdict: "inventory_active",
    targetVerdict: "inventory_manual",
    tenantId: "vaulttec",
    countryCode: "FR",
    policyDigest,
    releaseAttestation: releaseAttestationDescriptor,
    inventoryAccess: approvedPolicy(await writeActivationEvidence(evidenceRoot, "inventoryAccess_policy", scope)),
    killSwitches: { providerArmed: true, tenantCountryArmed: true },
    rollback: {
      exercised: true,
      evidence: await writeActivationEvidence(evidenceRoot, "rollback_exercise", scope),
      commandTranscriptId: "rollback-transcript-123",
    },
    shadowScorecard: await writeEvidence(evidenceRoot, "shadow/scorecard.json", shadowScorecard),
    writerOwnership,
    transitionEvidence: await writeTransitionEvidence(
      evidenceRoot,
      "inventory_manual",
      ["prior_state_receipt", "review", "ultraqa"],
      scope,
    ),
    manualDeepLink: {
      verified: true,
      environment: "production",
      evidence: await writeActivationEvidence(evidenceRoot, "manual_deep_link", scope),
    },
    applicationAutomationEnabled: false,
  };
}

function canonicalTestJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalTestJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalTestJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function phase0Input() {
  return {
    exactHead: "a".repeat(40),
    workingTreeStatus: "clean",
    migrationLedger: [{ id: "20260720000100", status: "observed" }],
    providerOwnership: [{ provider: "recruitee", writerRuntime: "none" }],
    environmentFlags: [{ name: "WORKER_CONTROL_ENABLED", state: "redacted:false" }],
    rollbackCommands: [{ id: "disable-recruitee", evidence: "runbooks/rollback.md" }],
    deployedRuntime: null,
    deployedArtifact: null,
    databaseMigrationState: null,
    providerBaselines: null,
    policies: {
      inventoryAccess: approvedPolicy(),
      submissionAuthority: { ...approvedPolicy(), verdict: "blocked" },
      candidateMandatePolicy: { ...approvedPolicy(), verdict: "blocked" },
      privacyBasis: { ...approvedPolicy(), verdict: "blocked" },
    },
  };
}
