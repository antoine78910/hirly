import { describe, expect, test } from "bun:test";
import { readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertDisposableDatabase,
  assertExpectedHead,
  buildChildEnvironment,
  buildReleaseVerificationPlan,
  collectArtifactAttestation,
  collectToolAttestations,
  deriveIsolatedDatabaseUrls,
  executeCommand,
  findUnsafeActivationStatements,
  parseFreshnessProof,
  redactSensitiveText,
  resolveManifestOutput,
  runReleaseVerification,
  verifyDeploymentDefaults,
  verifyDockerContext,
  writeManifestAtomic,
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
    const expectedHead = "a".repeat(40);
    const plan = buildReleaseVerificationPlan({
      profile: "full",
      databaseUrl,
      allowDisposableDatabase: true,
      expectedHead,
    });
    expect(plan.commands.map((entry) => entry.id).slice(0, 14)).toEqual([
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
      "legacy-frontend-artifact-proof",
      "worker-docker-proof",
    ]);
    expect(plan.commands.find((entry) => entry.id === "legacy-frontend-frozen-install")?.args).toEqual(["ci", "--legacy-peer-deps"]);
    expect(plan.commands.filter((entry) => /^postgres-.+-freshness$/.test(entry.id))).toHaveLength(8);
    expect(plan.commands.filter((entry) => /^postgres-(?:g\d+|ledger)$/.test(entry.id))).toHaveLength(7);
    expect(plan.commands.find((entry) => entry.id === "postgres-g002")?.redactEnvironment).toBe(true);
    expect(plan.commands.find((entry) => entry.id === "postgres-g002")?.args).toEqual([
      "test",
      "--timeout",
      "30000",
      "tests/g002-postgres.integration.test.ts",
    ]);
    expect(plan.expectedHead).toBe(expectedHead);
    expect(new Set(Object.values(plan.databaseUrls ?? {}))).toHaveLength(8);
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
    expect(parsed.pathname).toEndWith("_20260720120000_123_deadbeef_g014");
  });

  test("pins expected HEAD before running any child command", () => {
    const expectedHead = "a".repeat(40);
    expect(() => assertExpectedHead(expectedHead, "b".repeat(40))).toThrow("expected HEAD");
    expect(() => assertExpectedHead("short", "short")).toThrow("40-character");

    let executed = 0;
    const attestation = {
      head: "b".repeat(40),
      clean: true,
      status: "",
      contentDigest: "digest",
    };
    const manifest = runReleaseVerification(
      {
        profile: "full",
        expectedHead,
        commands: [{ id: "must-not-run", executable: "false", args: [], cwd: ".", env: {} }],
        blockedExternal: [],
        databaseUrls: null,
      },
      {
        attest: () => attestation,
        execute: () => {
          executed += 1;
          return { status: 0 };
        },
        collectArtifacts: () => ({}),
        collectTools: () => [],
      },
    );
    expect(executed).toBe(0);
    expect(manifest.results).toEqual([]);
    expect(manifest.overallStatus).toBe("failed");
    expect(manifest.preflightError).toContain("expected HEAD");
  });

  test("allowlists child environment and never exposes production sentinels", () => {
    const environment = buildChildEnvironment(
      { EXPLICIT_SAFE_VALUE: "present" },
      {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: "postgresql://production-secret",
        SUPABASE_SERVICE_ROLE_KEY: "production-secret",
        POSTHOG_API_KEY: "production-secret",
      },
    );
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(environment.POSTHOG_API_KEY).toBeUndefined();
    expect(environment.EXPLICIT_SAFE_VALUE).toBe("present");

    process.env.G015_PRODUCTION_SENTINEL = "must-not-leak";
    try {
      const result = executeCommand(
        {
          id: "environment-probe",
          executable: process.execPath,
          args: ["-e", "console.log(JSON.stringify({sentinel: process.env.G015_PRODUCTION_SENTINEL ?? 'absent'}))"],
          cwd: ".",
          env: {},
          captureJson: true,
        },
        { stdout: () => {}, stderr: () => {} },
      );
      expect(result.status).toBe(0);
      expect(result.evidence).toEqual({ sentinel: "absent" });
    } finally {
      delete process.env.G015_PRODUCTION_SENTINEL;
    }
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
    expect(result.dockerContext.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyDockerContext(root).requiredRules).toContain("**/node_modules");
  });

  test("rejects literal activation bypasses across every authoritative surface", () => {
    for (const table of [
      "provider_registry",
      "worker_schedules",
      "python_ingestion_schedules",
      "source_policy",
      "career_sources",
      "source_trial_policies",
    ]) {
      expect(findUnsafeActivationStatements(`UPDATE public.${table} SET enabled = true;`)).toContain(
        "literal_update_enablement",
      );
      expect(findUnsafeActivationStatements(`INSERT INTO public.${table} (id, enabled) VALUES ('x', true);`)).toContain(
        "literal_insert_enablement",
      );
    }
    expect(findUnsafeActivationStatements("UPDATE public.career_sources SET transport_enabled = true;")).toContain(
      "literal_update_enablement",
    );
    expect(findUnsafeActivationStatements("SELECT worker_private.set_provider_enabled('greenhouse', true);")).toContain(
      "activation_rpc",
    );
    expect(findUnsafeActivationStatements("UPDATE public.provider_registry SET writer_runtime = 'typescript';")).toContain(
      "writer_transfer",
    );
    expect(findUnsafeActivationStatements("DO $$ BEGIN UPDATE public.provider_registry SET enabled = true; END $$;")).toContain(
      "literal_update_enablement",
    );
    expect(findUnsafeActivationStatements("UPDATE public.provider_registry SET enabled = false, writer_runtime = 'none';")).toEqual([]);
  });

  test("requires eight distinct fresh local databases and rejects nonempty proofs", () => {
    const urls = deriveIsolatedDatabaseUrls("postgresql://release:secret@localhost/hirly_release_test");
    expect(Object.keys(urls)).toEqual(["g002", "g003", "g004", "g010", "g011", "ledger", "g014", "activation"]);
    expect(new Set(Object.values(urls))).toHaveLength(8);
    for (const value of Object.values(urls)) {
      expect(new URL(value).hostname).toBe("localhost");
      expect(new URL(value).pathname).toContain("test");
    }
    expect(parseFreshnessProof({ database: "hirly_release_test_g002", userSchemas: 0, userRelations: 0 })).toEqual({
      database: "hirly_release_test_g002",
      userSchemas: 0,
      userRelations: 0,
    });
    expect(() => parseFreshnessProof({
      database: "hirly_release_test_g002",
      userSchemas: 0,
      userRelations: 1,
    })).toThrow("not fresh/empty");
  });

  test("contains manifest output, writes atomically, and preserves Git status", async () => {
    expect(() => resolveManifestOutput("/tmp/escape.json", root)).toThrow("relative path");
    expect(() => resolveManifestOutput("../escape.json", root)).toThrow("stay under");
    expect(() => resolveManifestOutput(".omx/verification/../escape.json", root)).toThrow("stay under");

    const path = `.omx/verification/g015-test-${crypto.randomUUID()}.json`;
    const statusBefore = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      encoding: "utf8",
    }).stdout;
    try {
      const output = writeManifestAtomic(path, { status: "proof" }, root);
      expect(resolve(output)).toBe(resolve(root, path));
      expect(() => writeManifestAtomic(path, { status: "overwrite" }, root)).toThrow("new file");
      const statusAfter = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: root,
        encoding: "utf8",
      }).stdout;
      expect(statusAfter).toBe(statusBefore);
    } finally {
      await rm(resolve(root, path), { force: true });
    }
  });

  test("publishes reproducible artifact, migration, and frontend lock hashes", () => {
    const attestation = collectArtifactAttestation(root);
    expect(attestation.files["scripts/verify-job-supply-release.mjs"].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(attestation.files["bun.lock"].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(attestation.files["frontend/package-lock.json"].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(attestation.migrations.length).toBeGreaterThan(0);
    expect(attestation.migrations.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    expect(attestation.migrations.every((entry) => /^[0-9a-f]{64}$/.test(entry.downSha256))).toBe(true);

    const tools = collectToolAttestations([
      { id: "worker-docker-proof", executable: "node" },
      { id: "postgres-g002", executable: "bun" },
    ]);
    expect(tools.map((entry) => entry.executable)).toEqual(["bun", "docker", "node", "psql"]);
    expect(tools.every((entry) => entry.available && /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))).toBe(true);
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
