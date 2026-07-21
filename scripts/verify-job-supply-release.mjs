#!/usr/bin/env node

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const MANIFEST_VERSION = "job-supply-release-verification.v4";
const RELEASE_ATTESTATION_VERSION = "job-supply-release-attestation.v1";
const ATS_PHASE0_RECEIPT_VERSION = "ats-phase0-receipt.v1";
const EXTERNAL_DISCHARGE_VERSION = "job-supply-external-discharge.v1";
const ACTIVATION_EVIDENCE_VERSION = "job-supply-activation-evidence.v1";
const SHADOW_RUN_VERSION = "job-supply-shadow-run.v1";
const WRITER_OWNERSHIP_VERSION = "job-supply-writer-ownership.v1";
export const REQUIRED_FULL_RELEASE_COMMAND_IDS = Object.freeze([
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
const ALLOWED_EXTERNAL_BLOCKS = new Set([
  "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER",
  "SOURCE_ACTIVATION_NOT_PERFORMED",
]);
const PGCRYPTO_COMPAT_MIGRATION = "20260721001950_pgcrypto_schema_compatibility";
const MIGRATION_RE = /^(?:20260720\d+_.+|20260721001950_pgcrypto_schema_compatibility)\.sql$/;
const PYTHON_EXCEPTION_RE = /^\s*#\s*stack-policy:\s*python-exception=(.{12,})\s*$/im;
const DISPOSABLE_DB_RE = /(?:^|_)(?:test|disposable)(?:$|_)/i;
const SAFE_DATABASE_NAME_RE = /^[a-zA-Z0-9_]+$/;
const DATABASE_ENV_NAMES = [
  "G002_TEST_DATABASE_URL",
  "G003_TEST_DATABASE_URL",
  "G004_TEST_DATABASE_URL",
  "G010_TEST_DATABASE_URL",
  "G011_TEST_DATABASE_URL",
  "JOB_INGESTION_LEDGER_TEST_DATABASE_URL",
  "G014_TEST_DATABASE_URL",
  "PGCRYPTO_COMPAT_TEST_DATABASE_URL",
];
const SUITE_NAMES = ["g002", "g003", "g004", "g010", "g011", "ledger", "g014", "pgcrypto-compat"];
const GENERATED_DATABASE_NAME_RE = new RegExp(
  `_\\d{14}_\\d+_[a-f0-9]{8}_(?:${SUITE_NAMES.map((name) => name.replace(/[^a-zA-Z0-9_]/g, "_")).join("|")})$`,
);
const SAFE_INHERITED_ENV = new Set([
  "CI",
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
]);
const RELEASE_ARTIFACTS = [
  ".dockerignore",
  ".github/workflows/typescript-foundation.yml",
  "apps/worker/Dockerfile",
  "apps/worker/railway.toml",
  "backend/railway.toml",
  "backend/requirements.txt",
  "bun.lock",
  "frontend/package-lock.json",
  "frontend/package.json",
  "frontend/vercel.json",
  "package.json",
  "scripts/verify-job-supply-release.mjs",
  "tests/g015-release-readiness.test.ts",
  "vercel.json",
];
const BACKEND_COMPATIBILITY_TESTS = [
  "backend/tests/test_france_travail_provider.py",
  "backend/tests/test_france_travail_harvest.py",
  "backend/tests/test_ats_adapters.py",
  "backend/tests/test_ats_detection.py",
  "backend/tests/test_ats_source_service.py",
  "backend/tests/test_job_normalization.py",
  "backend/tests/test_job_validation.py",
  "backend/tests/test_jobs_upsert_batch.py",
  "backend/tests/test_job_cache_maintenance.py",
  "backend/tests/test_feed_db_first.py",
];

export function assertDisposableDatabase(databaseUrl, explicitlyAllowed) {
  if (!databaseUrl) return;
  if (!explicitlyAllowed) {
    throw new Error("PostgreSQL verification requires --allow-disposable-database");
  }
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("G015_TEST_DATABASE_URL must use postgres or postgresql");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("G015_TEST_DATABASE_URL must target a loopback host");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!DISPOSABLE_DB_RE.test(database)) {
    throw new Error("G015_TEST_DATABASE_URL database name must contain test or disposable");
  }
}

export function redactSensitiveText(value, secrets = []) {
  let redacted = String(value ?? "");
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join("[REDACTED]");
    try {
      const url = new URL(secret);
      if (url.password) redacted = redacted.split(url.password).join("[REDACTED]");
    } catch {}
  }
  return redacted.replace(
    /\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi,
    "$1[REDACTED]@",
  );
}

function blocked(code, category, message) {
  return { status: "BLOCKED_EXTERNAL", code, category, message };
}

export function buildReleaseVerificationPlan(options = {}) {
  const full = options.profile === "full";
  const includeFrontend = full || options.includeFrontend === true;
  const includeDocker = full || options.includeDocker === true;
  const databaseUrl = options.databaseUrl?.trim() || null;
  const verificationId = options.verificationId ?? createVerificationId();
  if (!/^[a-z0-9][a-z0-9-]{7,48}$/.test(verificationId)) {
    throw new Error("verificationId must be 8-49 lowercase alphanumeric/hyphen characters");
  }
  assertDisposableDatabase(databaseUrl, options.allowDisposableDatabase === true);
  const commands = [
    command("repository-attestation", "node", ["scripts/verify-job-supply-release.mjs", "--internal-attest-clean"]),
    command("frozen-install", "bun", ["install", "--frozen-lockfile"]),
    command("typecheck", "bun", ["run", "typecheck"]),
    command("lint", "bun", ["run", "lint"]),
    command("tests", "bun", ["run", "test"]),
    command("build", "bun", ["run", "build"]),
    command(
      "backend-python-compatibility",
      ".venv/bin/python",
      ["-m", "pytest", "-q", ...BACKEND_COMPATIBILITY_TESTS],
      { env: { PYTHONPATH: "backend" } },
    ),
    command("release-contracts", "bun", ["test", "tests/g015-release-readiness.test.ts"]),
    command("stack-policy-revision", "node", ["scripts/verify-job-supply-release.mjs", "--internal-stack-policy-revision"]),
    command("deployment-default-safety", "node", ["scripts/verify-job-supply-release.mjs", "--internal-deployment-default-safety"]),
    command("diff-check", "git", ["diff", "--check"]),
  ];

  if (includeFrontend) {
    commands.push(
      command("legacy-frontend-frozen-install", "npm", ["ci", "--legacy-peer-deps"], { cwd: "frontend" }),
      command(
        "legacy-frontend-security-audit",
        "npm",
        ["audit", "--omit=dev", "--audit-level=high"],
        { cwd: "frontend" },
      ),
      command(
        "legacy-frontend-tests",
        "npm",
        ["run", "test", "--", "--watchAll=false", "--runInBand"],
        { cwd: "frontend", env: { CI: "true" } },
      ),
      command("legacy-frontend-build", "npm", ["run", "build"], { cwd: "frontend", env: { CI: "false" } }),
    );
  }
  let dockerTag = null;
  if (includeDocker) {
    dockerTag = `hirly-worker:release-verification-${verificationId}`;
    commands.push(
      command("worker-docker-build", "docker", [
        "build",
        "--pull=false",
        "-f",
        "apps/worker/Dockerfile",
        "-t",
        dockerTag,
        ".",
      ]),
      command("worker-docker-proof", "docker", ["image", "inspect", dockerTag], {
        captureOutput: true,
        evidenceKind: "docker-image",
      }),
    );
  }
  let databaseUrls = null;
  if (databaseUrl) {
    const suiteUrls = Object.fromEntries(
      SUITE_NAMES.map((name) => [
        name,
        isolatedDatabaseUrl(databaseUrl, `${verificationId.replaceAll("-", "_")}_${name}`),
      ]),
    );
    databaseUrls = Object.fromEntries(
      DATABASE_ENV_NAMES.map((name, index) => [name, suiteUrls[SUITE_NAMES[index]]]),
    );
    commands.push(command(
      "postgres-provision",
      "node",
      ["scripts/verify-job-supply-release.mjs", "--internal-provision-databases"],
      {
        env: databaseUrls,
        redactEnvironment: true,
        captureOutput: true,
        evidenceKind: "postgres-provision",
      },
    ));
    commands.push(command("postgres-release-matrix", "bun", [
      "test",
      "tests/g002-postgres.integration.test.ts",
      "tests/g003-postgres-runtime.integration.test.ts",
      "tests/g004-postgres-runtime.integration.test.ts",
      "tests/g010-provider-ownership-postgres.integration.test.ts",
      "tests/g011-ats-tenant-registration-postgres.integration.test.ts",
      "tests/job-ingestion-ledger-postgres.integration.test.ts",
      "tests/g014-source-trial-postgres.integration.test.ts",
      "tests/pgcrypto-schema-compatibility-postgres.integration.test.ts",
    ], {
      env: databaseUrls,
      redactEnvironment: true,
    }));
    commands.push(command(
      "postgres-disabled-state-proof",
      "node",
      ["scripts/verify-job-supply-release.mjs", "--internal-disabled-state-proof"],
      {
        env: { G014_TEST_DATABASE_URL: suiteUrls.g014 },
        redactEnvironment: true,
        captureOutput: true,
        evidenceKind: "postgres-disabled-state",
      },
    ));
  }
  return {
    profile: full ? "full" : "repository",
    expectedHead: options.expectedHead ?? null,
    verificationId,
    dockerTag,
    databaseUrls,
    commands,
    blockedExternal: [
      ...(!includeFrontend ? [blocked("FRONTEND_NOT_REQUESTED", "repository", "legacy frontend build not requested; use --with-frontend or --profile full")] : []),
      ...(!includeDocker ? [blocked("DOCKER_NOT_REQUESTED", "repository", "worker Docker build not requested; use --with-docker or --profile full")] : []),
      ...(!databaseUrl ? [blocked("DATABASE_NOT_PROVIDED", "infrastructure", "PostgreSQL release matrix requires G015_TEST_DATABASE_URL plus --allow-disposable-database")] : []),
      blocked(
        "REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER",
        "deployment",
        "this repository verifier neither performs nor inspects remote Vercel/Railway deployments; attach a separate authorized production-state attestation",
      ),
      blocked("SOURCE_ACTIVATION_NOT_PERFORMED", "source", "provider/source activation and external source fetching were not performed"),
    ],
  };
}

export function isolatedDatabaseUrl(databaseUrl, suite) {
  const parsed = new URL(databaseUrl);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const suffix = String(suite).replace(/[^a-zA-Z0-9_]/g, "_");
  const maximumPrefixLength = Math.max(1, 63 - suffix.length - 1);
  let prefix = name.slice(0, maximumPrefixLength);
  if (!DISPOSABLE_DB_RE.test(prefix)) {
    const marker = name.match(/(?:^|_)(test|disposable)(?:_|$)/i)?.[1]?.toLowerCase();
    if (!marker) {
      throw new Error("isolated database name lost its disposable marker");
    }
    const headLength = Math.max(1, maximumPrefixLength - marker.length - 1);
    prefix = `${name.slice(0, headLength).replace(/_+$/, "")}_${marker}`;
  }
  parsed.pathname = `/${prefix}_${suffix}`;
  return parsed.toString();
}

function command(id, executable, args, options = {}) {
  return {
    id,
    executable,
    args,
    cwd: options.cwd ?? ".",
    env: options.env ?? {},
    redactEnvironment: options.redactEnvironment ?? false,
    captureOutput: options.captureOutput ?? false,
    evidenceKind: options.evidenceKind ?? null,
  };
}

export function createVerificationId(now = new Date(), entropy = randomBytes(4).toString("hex")) {
  return `${now.toISOString().replace(/\D/g, "").slice(0, 14)}-${process.pid}-${entropy}`.toLowerCase();
}

function databaseConnectionEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return {
    ...sanitizedEnvironment(),
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
  };
}

function databaseName(databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (!SAFE_DATABASE_NAME_RE.test(name)) {
    throw new Error(`unsafe disposable database name: ${name}`);
  }
  return name;
}

function maintenanceDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = "/postgres";
  parsed.hash = "";
  return parsed.toString();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function psql(databaseUrl, sql, options = {}) {
  const result = spawnSync(
    "psql",
    ["-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-c", sql],
    {
      encoding: "utf8",
      env: databaseConnectionEnvironment(databaseUrl),
      stdio: "pipe",
    },
  );
  if (options.allowFailure || result.status === 0) return result;
  throw new Error(redactSensitiveText(result.stderr || result.stdout, [databaseUrl]));
}

export function disposableDatabaseUrlsFromEnvironment(environment = process.env) {
  const urls = DATABASE_ENV_NAMES.map((name) => environment[name]).filter(Boolean);
  if (urls.length !== DATABASE_ENV_NAMES.length) {
    throw new Error("all eight isolated PostgreSQL database URLs are required");
  }
  if (new Set(urls).size !== DATABASE_ENV_NAMES.length) {
    throw new Error("PostgreSQL release suites require eight distinct database URLs");
  }
  for (const url of urls) {
    assertDisposableDatabase(url, true);
    const name = databaseName(url);
    if (!GENERATED_DATABASE_NAME_RE.test(name)) {
      throw new Error(`database ${name} was not generated by this verifier run`);
    }
  }
  return urls;
}

export function provisionDisposableDatabases(urls = disposableDatabaseUrlsFromEnvironment()) {
  const created = [];
  try {
    for (const databaseUrl of urls) {
      const name = databaseName(databaseUrl);
      if (!GENERATED_DATABASE_NAME_RE.test(name)) {
        throw new Error(`refusing to provision an unrecognized database: ${name}`);
      }
      const maintenanceUrl = maintenanceDatabaseUrl(databaseUrl);
      const exists = psql(
        maintenanceUrl,
        `SELECT count(*) FROM pg_database WHERE datname = ${sqlLiteral(name)};`,
      ).stdout.trim();
      if (exists !== "0") {
        throw new Error(`refusing to reuse existing disposable database: ${name}`);
      }
      psql(maintenanceUrl, `CREATE DATABASE ${sqlIdentifier(name)} TEMPLATE template0;`);
      created.push(databaseUrl);
      const empty = psql(
        databaseUrl,
        `SELECT count(*) FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND n.nspname NOT LIKE 'pg_toast%'
           AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');`,
      ).stdout.trim();
      if (empty !== "0") {
        throw new Error(`new disposable database was not empty: ${name}`);
      }
    }
  } catch (error) {
    cleanupDisposableDatabases(created);
    throw error;
  }
  return {
    databaseCount: created.length,
    distinctDatabaseCount: new Set(created.map(databaseName)).size,
    emptyDatabaseCount: created.length,
    databases: created.map((url) => databaseName(url)),
  };
}

export function cleanupDisposableDatabases(urls = disposableDatabaseUrlsFromEnvironment()) {
  const results = [];
  for (const databaseUrl of urls) {
    assertDisposableDatabase(databaseUrl, true);
    const name = databaseName(databaseUrl);
    if (!GENERATED_DATABASE_NAME_RE.test(name)) {
      throw new Error(`refusing to clean an unrecognized database: ${name}`);
    }
    const maintenanceUrl = maintenanceDatabaseUrl(databaseUrl);
    psql(
      maintenanceUrl,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = ${sqlLiteral(name)} AND pid <> pg_backend_pid();`,
    );
    const result = psql(
      maintenanceUrl,
      `DROP DATABASE IF EXISTS ${sqlIdentifier(name)};`,
      { allowFailure: true },
    );
    results.push({ database: name, dropped: result.status === 0 });
  }
  return results;
}

export function verifyPostMigrationDisabledState(
  databaseUrl = process.env.G014_TEST_DATABASE_URL,
) {
  if (!databaseUrl) throw new Error("G014_TEST_DATABASE_URL is required");
  assertDisposableDatabase(databaseUrl, true);
  const result = psql(databaseUrl, `
    SELECT jsonb_build_object(
      'enabledProviders', (
        SELECT count(*) FROM public.provider_registry WHERE enabled
      ),
      'typescriptWriters', (
        SELECT count(*) FROM public.provider_registry
        WHERE writer_runtime = 'typescript'
      ),
      'enabledWorkerSchedules', (
        SELECT count(*) FROM public.worker_schedules WHERE enabled
      ),
      'enabledPythonSchedules', (
        SELECT count(*) FROM public.python_ingestion_schedules WHERE enabled
      ),
      'enabledCareerSources', (
        SELECT count(*) FROM public.career_sources
        WHERE enabled OR transport_enabled OR incremental_enabled OR backfill_enabled
      ),
      'enabledProductionPolicies', (
        SELECT count(*) FROM public.source_policy
        WHERE enabled OR 'production' = ANY(enabled_environments)
      ),
      'productionEligibleEvidence', (
        SELECT count(*) FROM public.source_policy_evidence WHERE production_eligible
      )
    );
  `);
  const proof = JSON.parse(result.stdout.trim());
  const violations = Object.entries(proof).filter(([, count]) => Number(count) !== 0);
  if (violations.length) {
    throw new Error(
      `post-migration activation state is not disabled: ${violations
        .map(([key, count]) => `${key}=${count}`)
        .join(", ")}`,
    );
  }
  return proof;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", env: process.env });
  if (options.allowFailure || result.status === 0) return result;
  throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

export function repositoryAttestation() {
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  const trackedDiff = git(["diff", "--binary", "HEAD"]).stdout;
  return {
    head,
    clean: status.length === 0,
    status,
    contentDigest: createHash("sha256").update(head).update("\0").update(trackedDiff).update("\0").update(status).digest("hex"),
  };
}

function revisionBase() {
  if (process.env.G015_BASE_SHA) return process.env.G015_BASE_SHA;
  const mergeBase = git(["merge-base", "HEAD", "origin/main"], { allowFailure: true });
  if (mergeBase.status === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
  return "HEAD^";
}

export function verifyStackPolicyRevision(base = revisionBase()) {
  const validBase = git(["rev-parse", "--verify", `${base}^{commit}`], { allowFailure: true });
  if (validBase.status !== 0) throw new Error(`invalid stack-policy revision base: ${base}`);
  const files = git(["diff", "--name-only", "--diff-filter=A", `${base}..HEAD`]).stdout.trim().split("\n").filter(Boolean);
  const violations = [];
  for (const file of files.filter((name) => name.startsWith("backend/") && name.endsWith(".py") && !name.startsWith("backend/tests/"))) {
    const content = git(["show", `HEAD:${file}`]).stdout.split("\n").slice(0, 10).join("\n");
    if (!PYTHON_EXCEPTION_RE.test(content)) violations.push(file);
  }
  if (violations.length) throw new Error(`new production Python modules lack stack-policy exception: ${violations.join(", ")}`);
  return { base, head: git(["rev-parse", "HEAD"]).stdout.trim(), addedFilesChecked: files.length };
}

export function findMigrationActivationStatements(sql) {
  const withoutFunctions = sql
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "");
  const activationTables =
    "(?:provider_registry|worker_schedules|career_sources|source_policy|source_policy_evidence|python_ingestion_schedules)";
  const activationColumns =
    "(?:enabled|transport_enabled|incremental_enabled|backfill_enabled|production_eligible)";
  const statements = withoutFunctions.match(
    new RegExp(
      `(?:INSERT\\s+INTO|UPDATE)\\s+(?:public\\.)?${activationTables}\\b[\\s\\S]*?;`,
      "gi",
    ),
  ) ?? [];
  return statements.filter(
    (statement) => {
      const withoutStringLiterals = statement.replace(/'(?:''|[^'])*'/g, "''");
      return (
        new RegExp(`\\b${activationColumns}\\b`, "i").test(withoutStringLiterals)
        && /\btrue\b/i.test(withoutStringLiterals)
      );
    },
  );
}

export function verifyDeploymentDefaults(root = process.cwd()) {
  const migrationDir = resolve(root, "backend/db/migrations");
  const ups = readdirSync(migrationDir).filter((name) => MIGRATION_RE.test(name) && !name.endsWith(".down.sql")).sort();
  const downs = new Set(readdirSync(migrationDir).filter((name) => name.endsWith(".down.sql")));
  const missingDown = ups.filter((name) => !downs.has(name.replace(/\.sql$/, ".down.sql")));
  if (missingDown.length) throw new Error(`migrations missing down files: ${missingDown.join(", ")}`);
  for (const name of ups) {
    const sql = readFileSync(resolve(migrationDir, name), "utf8");
    const activationStatements = findMigrationActivationStatements(sql);
    if (activationStatements.length) {
      throw new Error(`${name} contains a top-level provider/source/schedule activation`);
    }
  }
  const dockerfile = readFileSync(resolve(root, "apps/worker/Dockerfile"), "utf8");
  if (
    !/^USER\s+bun\s*$/m.test(dockerfile)
    || !/^CMD\s+\[\s*"[^"]+"(?:\s*,\s*"[^"]+")*\s*\]\s*$/m.test(dockerfile)
    || /^COPY\s+(?:--[^\s]+\s+)*(?:\.[^\s]*env|[^\s]*\.env(?:\.[^\s]+)?)(?:\s|$)/im.test(dockerfile)
  ) {
    throw new Error("worker Dockerfile must use USER bun, exec-form CMD, and never copy env files");
  }

  const railway = readFileSync(resolve(root, "apps/worker/railway.toml"), "utf8");
  const drainingSeconds = Number(railway.match(/drainingSeconds\s*=\s*(\d+)/)?.[1]);
  const runtimeConfig = readFileSync(resolve(root, "apps/worker/src/runtime/config.ts"), "utf8");
  const shutdownLiteral = runtimeConfig.match(/WORKER_SHUTDOWN_MS:[\s\S]*?\.default\(([\d_]+)\)/)?.[1];
  const shutdownMs = Number(shutdownLiteral?.replaceAll("_", ""));
  const sharedConfig = readFileSync(resolve(root, "packages/config/src/index.ts"), "utf8");
  if (
    !railway.includes('healthcheckPath = "/health/ready"')
    || !Number.isFinite(drainingSeconds)
    || !Number.isFinite(shutdownMs)
    || drainingSeconds * 1_000 <= shutdownMs
    || !/WORKER_CONTROL_ENABLED:[\s\S]*?\.default\("false"\)/.test(sharedConfig)
  ) {
    throw new Error("worker Railway readiness, draining, or control defaults are unsafe");
  }
  const backendRailway = readFileSync(resolve(root, "backend/railway.toml"), "utf8");
  if (
    !/^startCommand\s*=\s*"python run_server\.py"\s*$/m.test(backendRailway)
    || !/^healthcheckPath\s*=\s*"\/api\/health"\s*$/m.test(backendRailway)
  ) {
    throw new Error("backend Railway config must retain the FastAPI start command and health route");
  }

  const rootVercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
  const frontendVercel = JSON.parse(readFileSync(resolve(root, "frontend/vercel.json"), "utf8"));
  if (JSON.stringify(rootVercel).includes("apps/worker") || JSON.stringify(rootVercel.rewrites) !== JSON.stringify(frontendVercel.rewrites)) {
    throw new Error("Vercel routing would expose or diverge onto the worker");
  }
  if (rootVercel.git?.deploymentEnabled !== false || frontendVercel.git?.deploymentEnabled !== false) {
    throw new Error("Vercel Git auto-deployments must remain disabled for staged workflow ownership");
  }
  return { migrations: ups, workerDockerValidated: true, backendRailwayValidated: true };
}

function parseArgs(argv) {
  const options = { profile: "repository", output: null, includeFrontend: false, includeDocker: false, planOnly: false, expectedHead: process.env.G015_EXPECTED_HEAD ?? null, databaseUrl: process.env.G015_TEST_DATABASE_URL ?? null, allowDisposableDatabase: process.env.G015_ALLOW_DISPOSABLE_DATABASE === "true" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--with-frontend") options.includeFrontend = true;
    else if (argument === "--with-docker") options.includeDocker = true;
    else if (argument === "--allow-disposable-database") options.allowDisposableDatabase = true;
    else if (argument === "--expected-head") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--expected-head requires a commit SHA");
      options.expectedHead = value;
    }
    else if (argument === "--plan") options.planOnly = true;
    else if (argument === "--profile") {
      const value = argv[++index];
      if (!["repository", "full"].includes(value)) throw new Error("--profile must be repository or full");
      options.profile = value;
    } else if (argument === "--output") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--output requires a path");
      options.output = value;
    } else throw new Error(`unsupported argument: ${argument}`);
  }
  return options;
}

function parseNamedArgs(argv, required) {
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`${flag ?? "argument"} requires a value`);
    }
    const name = flag.slice(2);
    if (!required.includes(name)) throw new Error(`unsupported argument: ${flag}`);
    values[name] = value;
  }
  const missing = required.filter((name) => !values[name]);
  if (missing.length) throw new Error(`missing required arguments: ${missing.map((name) => `--${name}`).join(", ")}`);
  return values;
}

export function sanitizedEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => SAFE_INHERITED_ENV.has(key) && value),
  );
}

export function executeCommand(item, output = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) }) {
  const captureOutput = item.redactEnvironment || item.captureOutput;
  const result = spawnSync(item.executable, item.args, {
    cwd: resolve(process.cwd(), item.cwd),
    env: { ...sanitizedEnvironment(), ...item.env },
    encoding: captureOutput ? "utf8" : undefined,
    stdio: captureOutput ? "pipe" : "inherit",
    shell: false,
  });
  if (captureOutput) {
    const secrets = Object.values(item.env);
    const stdout = redactSensitiveText(result.stdout, secrets);
    const stderr = redactSensitiveText(result.stderr, secrets);
    output.stdout(stdout);
    output.stderr(stderr);
    return { ...result, stdout, stderr };
  }
  return result;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function defaultReleaseManifestOutput(verificationId) {
  if (!/^[a-z0-9][a-z0-9-]{7,48}$/.test(String(verificationId))) {
    throw new Error("verificationId must be valid before deriving the output path");
  }
  return `.omx/verification/job-supply-release-${verificationId}.json`;
}

export function validateSelectedManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("selected manifest must be an object");
  }
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`selected manifest version must be ${MANIFEST_VERSION}`);
  }
  if (manifest.overallStatus !== "passed") {
    throw new Error("selected manifest overallStatus must be passed");
  }
  if (manifest.profile !== "full") {
    throw new Error("selected manifest profile must be full");
  }
  if (!Array.isArray(manifest.results) || manifest.results.length === 0) {
    throw new Error("selected manifest must contain non-empty results");
  }
  const failedCommands = manifest.results
    .filter((result) => result?.status !== "passed")
    .map((result, index) => String(result?.id ?? `result-${index}`));
  if (failedCommands.length) {
    throw new Error(`selected manifest has non-passing commands: ${failedCommands.join(", ")}`);
  }
  const resultIds = manifest.results.map((result) => String(result?.id ?? ""));
  if (resultIds.some((id) => !id)) throw new Error("selected manifest result IDs are required");
  if (new Set(resultIds).size !== resultIds.length) {
    throw new Error("selected manifest result IDs must be unique");
  }
  const requiredIds = new Set(REQUIRED_FULL_RELEASE_COMMAND_IDS);
  const missingResultIds = REQUIRED_FULL_RELEASE_COMMAND_IDS.filter((id) => !resultIds.includes(id));
  const extraResultIds = resultIds.filter((id) => !requiredIds.has(id));
  if (missingResultIds.length || extraResultIds.length) {
    throw new Error(
      `selected manifest command IDs must exactly match the full release plan; missing: ${missingResultIds.join(", ") || "none"}; extra: ${extraResultIds.join(", ") || "none"}`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(String(manifest.exactHead ?? ""))) {
    throw new Error("selected manifest exactHead must be a lowercase 40-character commit SHA");
  }
  if (manifest.expectedHead !== manifest.exactHead) {
    throw new Error("selected manifest expectedHead must equal exactHead");
  }
  const blocks = manifest.blockedExternal ?? [];
  if (!Array.isArray(blocks)) throw new Error("selected manifest blockedExternal must be an array");
  const externalBlockCodes = blocks.map((entry) => entry?.code);
  const unexpected = externalBlockCodes.filter((code) => !ALLOWED_EXTERNAL_BLOCKS.has(code));
  if (unexpected.length) {
    throw new Error(`selected manifest has unexpected external blocks: ${unexpected.join(", ")}`);
  }
  if (new Set(externalBlockCodes).size !== externalBlockCodes.length) {
    throw new Error("selected manifest external block codes must be unique");
  }
  const missing = [...ALLOWED_EXTERNAL_BLOCKS].filter((code) => !externalBlockCodes.includes(code));
  if (missing.length) {
    throw new Error(`selected manifest is missing mandatory external blocks: ${missing.join(", ")}`);
  }
  if (options.requireVerificationId !== false && !String(manifest.verificationId ?? "").trim()) {
    throw new Error("selected manifest verificationId is required");
  }
  return { exactHead: manifest.exactHead, externalBlockCodes };
}

function containedEvidenceDescriptor(descriptor, evidenceRoot = process.cwd()) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error("evidence descriptor must be an object");
  }
  if (Object.keys(descriptor).sort().join(",") !== "path,sha256") {
    throw new Error("evidence descriptor must contain only path and sha256");
  }
  if (typeof descriptor.path !== "string" || !descriptor.path.trim()) {
    throw new Error("evidence descriptor path is required");
  }
  if (!/^[0-9a-f]{64}$/.test(String(descriptor.sha256 ?? ""))) {
    throw new Error("evidence descriptor sha256 must be a lowercase SHA-256 digest");
  }
  const root = realpathSync(resolve(evidenceRoot));
  const absolute = resolve(root, descriptor.path);
  const containment = relative(root, absolute);
  if (
    !containment
    || containment === ".."
    || containment.startsWith(`..${sep}`)
    || resolve(root, containment) !== absolute
  ) {
    throw new Error("evidence descriptor path must be contained under evidenceRoot");
  }
  let realPath;
  try {
    realPath = realpathSync(absolute);
  } catch {
    throw new Error(`evidence descriptor file does not exist: ${descriptor.path}`);
  }
  const realContainment = relative(root, realPath);
  if (realContainment === ".." || realContainment.startsWith(`..${sep}`)) {
    throw new Error("evidence descriptor path must not escape evidenceRoot through symbolic links");
  }
  const bytes = readFileSync(realPath);
  if (sha256(bytes) !== descriptor.sha256) {
    throw new Error(`evidence descriptor digest mismatch: ${descriptor.path}`);
  }
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`evidence descriptor must contain valid JSON: ${descriptor.path}`);
  }
  return { descriptor: { path: descriptor.path, sha256: descriptor.sha256 }, bytes, json };
}

function durableEvidence(discharge) {
  const evidence = discharge?.evidence ?? discharge?.evidenceLinks ?? discharge?.evidencePaths;
  if (Array.isArray(evidence)) return evidence.filter((item) => typeof item === "string" && item.trim());
  return typeof evidence === "string" && evidence.trim() ? [evidence] : [];
}

function activationScope(input) {
  return {
    provider: String(input.provider ?? "").trim(),
    tenantId: String(input.tenantId ?? "").trim().toLowerCase(),
    countryCode: String(input.countryCode ?? "").trim().toUpperCase(),
    policyDigest: String(input.policyDigest ?? ""),
    releaseHead: String(input.releaseAttestation?.releaseHead ?? ""),
    deployedArtifactDigest: String(input.releaseAttestation?.deployedArtifactDigest ?? ""),
  };
}

export function signActivationEvidenceRecord(record, key) {
  if (typeof key !== "string" || key.length < 32) {
    throw new Error("activation attestation HMAC key must contain at least 32 characters");
  }
  const { signature: _signature, ...unsigned } = record;
  return createHmac("sha256", key).update(canonicalJson(unsigned)).digest("hex");
}

function validateActivationProvenance(record, trust, label) {
  assertOnlyKeys(record, trust.allowedKeys, label);
  if (!trust.key || trust.key.length < 32 || !trust.issuer || !trust.workflowId || !trust.workflowRunId) {
    throw new Error("trusted activation attestation configuration is incomplete");
  }
  if (
    record.issuer !== trust.issuer
    || record.workflowId !== trust.workflowId
    || record.workflowRunId !== trust.workflowRunId
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,255}$/.test(String(record.evidenceId ?? ""))
    || !/^[0-9a-f]{64}$/.test(String(record.signature ?? ""))
  ) throw new Error(`${label} trusted issuer, workflow, run, evidence ID, or signature is invalid`);
  const expected = signActivationEvidenceRecord(record, trust.key);
  if (!timingSafeEqual(Buffer.from(record.signature, "hex"), Buffer.from(expected, "hex"))) {
    throw new Error(`${label} signature is invalid`);
  }
  const observedAt = Date.parse(record.observedAt);
  if (
    Number.isNaN(observedAt)
    || observedAt > trust.now + trust.maxFutureSkewMs
    || observedAt < trust.now - trust.maxAgeMs
  ) throw new Error(`${label} observedAt is future-dated or stale`);
  if (trust.evidenceIds.has(record.evidenceId)) throw new Error(`${label} evidenceId was replayed`);
  const runKind = `${record.workflowRunId}:${record.kind}`;
  if (Object.hasOwn(record, "schemaVersion") && trust.runKinds.has(runKind)) {
    throw new Error(`${label} workflow run and kind were replayed`);
  }
  trust.evidenceIds.add(record.evidenceId);
  if (Object.hasOwn(record, "schemaVersion")) trust.runKinds.add(runKind);
}

function validateActivationSemantics(record, expectedKind, label) {
  if (expectedKind.endsWith("_review")) {
    assertOnlyKeys(record.review, ["architecture", "codeReview", "security"], `${label} review verdicts`);
    assertOnlyKeys(record.review?.security, ["unresolvedFindings", "verdict"], `${label} security review`);
    assertOnlyKeys(record.review?.codeReview, ["verdict"], `${label} code review`);
    assertOnlyKeys(record.review?.architecture, ["verdict"], `${label} architecture review`);
    if (
      record.review?.security?.verdict !== "CLEAN"
      || record.review?.security?.unresolvedFindings !== 0
      || record.review?.codeReview?.verdict !== "APPROVE"
      || record.review?.architecture?.verdict !== "CLEAR"
    ) {
      throw new Error(`${label} must record security CLEAN with zero unresolved findings, code review APPROVE, and architecture CLEAR`);
    }
  } else if (Object.hasOwn(record, "review")) {
    throw new Error(`${label} must not contain review verdicts`);
  }
  if (expectedKind.endsWith("_ultraqa")) {
    assertOnlyKeys(record.ultraqa, ["status"], `${label} UltraQA result`);
    if (record.ultraqa?.status !== "passed") {
      throw new Error(`${label} must record UltraQA passed`);
    }
  } else if (Object.hasOwn(record, "ultraqa")) {
    throw new Error(`${label} must not contain an UltraQA result`);
  }
}

function validateActivationEvidence(descriptor, input, evidenceRoot, expectedKind, trust) {
  const envelope = containedEvidenceDescriptor(descriptor, evidenceRoot).json;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error(`${expectedKind} evidence envelope must be an object`);
  }
  validateActivationProvenance(envelope, { ...trust, allowedKeys: [
    "artifacts", "countryCode", "deployedArtifactDigest", "kind", "observedAt",
    "evidenceId", "issuer", "policyDigest", "provider", "releaseHead", "review",
    "schemaVersion", "signature", "status", "tenantId", "ultraqa", "workflowId",
    "workflowRunId",
  ] }, `${expectedKind} evidence envelope`);
  const scope = activationScope(input);
  if (
    envelope.schemaVersion !== ACTIVATION_EVIDENCE_VERSION
    || envelope.kind !== expectedKind
    || envelope.status !== "passed"
    || envelope.provider !== scope.provider
    || String(envelope.tenantId ?? "").toLowerCase() !== scope.tenantId
    || String(envelope.countryCode ?? "").toUpperCase() !== scope.countryCode
    || envelope.policyDigest !== scope.policyDigest
    || envelope.releaseHead !== scope.releaseHead
    || envelope.deployedArtifactDigest !== scope.deployedArtifactDigest
    || !envelope.observedAt
    || Number.isNaN(Date.parse(envelope.observedAt))
  ) {
    throw new Error(`${expectedKind} evidence envelope scope or status is invalid`);
  }
  validateActivationSemantics(envelope, expectedKind, `${expectedKind} evidence envelope`);
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length === 0) {
    throw new Error(`${expectedKind} evidence envelope must seal underlying artifacts`);
  }
  const sealed = envelope.artifacts.map((artifact) => containedEvidenceDescriptor(artifact, evidenceRoot));
  for (const artifact of sealed) {
    validateActivationProvenance(artifact.json, { ...trust, allowedKeys: [
      "deployedArtifactDigest", "evidenceId", "issuer", "kind", "observedAt",
      "releaseHead", "result", "review", "signature", "ultraqa", "workflowId",
      "workflowRunId",
    ] }, `${expectedKind} underlying artifact`);
    if (
      artifact.json?.kind !== expectedKind
      || artifact.json?.result !== "passed"
      || artifact.json?.releaseHead !== scope.releaseHead
      || artifact.json?.deployedArtifactDigest !== scope.deployedArtifactDigest
    ) {
      throw new Error(`${expectedKind} underlying artifact scope or result is invalid`);
    }
    validateActivationSemantics(artifact.json, expectedKind, `${expectedKind} underlying artifact`);
  }
  const identities = sealed.map(({ descriptor: artifact }) => `${artifact.path}:${artifact.sha256}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${expectedKind} evidence artifacts must be unique`);
  }
  return envelope;
}

function requireActivationEvidence(record, input, evidenceRoot, kind, failures, trust) {
  try {
    validateActivationEvidence(record?.evidence, input, evidenceRoot, kind, trust);
  } catch (error) {
    failures.push(`${kind} sealed evidence is required: ${error.message}`);
  }
}

export function createReleaseAttestation({
  selectedManifest,
  discharges = [],
  deployedArtifactDigest,
  releaseHead,
  createdAt = new Date().toISOString(),
  evidenceRoot = process.cwd(),
} = {}) {
  const sealedManifest = containedEvidenceDescriptor(selectedManifest, evidenceRoot);
  const manifest = sealedManifest.json;
  const selected = validateSelectedManifest(manifest);
  if (releaseHead !== selected.exactHead) {
    throw new Error("releaseHead must equal the selected manifest exactHead");
  }
  if (!/^[0-9a-f]{64}$/.test(String(deployedArtifactDigest ?? ""))) {
    throw new Error("deployedArtifactDigest must be a lowercase SHA-256 digest");
  }
  if (Number.isNaN(Date.parse(createdAt))) throw new Error("createdAt must be a valid timestamp");
  if (!Array.isArray(discharges)) throw new Error("discharges must be an array");
  const byCode = new Map();
  for (const descriptor of discharges) {
    const sealed = containedEvidenceDescriptor(descriptor, evidenceRoot);
    const discharge = sealed.json;
    if (!discharge || typeof discharge !== "object" || Array.isArray(discharge)) {
      throw new Error("external discharge evidence must contain an object");
    }
    const allowedKeys = ["code", "deployedArtifactDigest", "observedAt", "releaseHead", "status", "version"];
    if (Object.keys(discharge).sort().join(",") !== allowedKeys.sort().join(",")) {
      throw new Error("external discharge evidence has an invalid schema");
    }
    if (discharge.version !== EXTERNAL_DISCHARGE_VERSION) {
      throw new Error(`external discharge version must be ${EXTERNAL_DISCHARGE_VERSION}`);
    }
    const code = discharge.code;
    if (!ALLOWED_EXTERNAL_BLOCKS.has(code)) throw new Error(`unexpected discharge code: ${code}`);
    if (byCode.has(code)) throw new Error(`duplicate discharge code: ${code}`);
    if (discharge.status !== "discharged") throw new Error(`discharge ${code} must have status discharged`);
    if (discharge.releaseHead !== releaseHead) throw new Error(`discharge ${code} releaseHead mismatch`);
    if (discharge.deployedArtifactDigest !== deployedArtifactDigest) {
      throw new Error(`discharge ${code} deployedArtifactDigest mismatch`);
    }
    if (!discharge.observedAt || Number.isNaN(Date.parse(discharge.observedAt))) {
      throw new Error(`discharge ${code} observedAt must be a valid timestamp`);
    }
    byCode.set(code, sealed.descriptor);
  }
  const missing = selected.externalBlockCodes.filter((code) => !byCode.has(code));
  const unexpected = [...byCode.keys()].filter((code) => !selected.externalBlockCodes.includes(code));
  if (missing.length) throw new Error(`missing external block discharges: ${missing.join(", ")}`);
  if (unexpected.length) throw new Error(`unexpected external block discharges: ${unexpected.join(", ")}`);
  return {
    version: RELEASE_ATTESTATION_VERSION,
    createdAt,
    releaseHead,
    deployedArtifactDigest,
    selectedManifest: sealedManifest.descriptor,
    externalBlockDischarges: selected.externalBlockCodes.map((code) => byCode.get(code)),
    readinessStatus: "ATTESTED_READY",
  };
}

export function classifyReleaseDrift(change = {}) {
  const matrix = {
    build_input: {
      invalidatesSelectedManifest: true,
      invalidatesCodeReview: true,
      requiresFullVerifier: true,
      requiredEvidence: ["full-verifier", "security-review", "code-review", "ultraqa", "artifact-attestation"],
    },
    runtime_config_outside_envelope: {
      invalidatesSelectedManifest: change.affectsBuildInputs === true,
      invalidatesCodeReview: false,
      requiresFullVerifier: change.affectsBuildInputs === true,
      requiredEvidence: [
        ...(change.affectsBuildInputs === true ? ["full-verifier"] : []),
        "affected-security-review", "ultraqa", "deployment-attestation", "deployed-smoke", "rollback-proof",
      ],
    },
    rollout_config_inside_envelope: {
      invalidatesSelectedManifest: false,
      invalidatesCodeReview: false,
      requiresFullVerifier: false,
      requiredEvidence: ["change-record", "canonical-configuration-digest", "policy-expiry-check", "deployed-smoke", "rollback-proof"],
    },
    candidate_mandate: {
      invalidatesSelectedManifest: false,
      invalidatesCodeReview: false,
      requiresFullVerifier: false,
      requiredEvidence: ["claim-check", "post-claim-check", "pre-submit-check", "attempt-evidence"],
    },
  };
  if (!Object.hasOwn(matrix, change.kind)) throw new Error(`unknown release drift kind: ${change.kind ?? "missing"}`);
  const classification = matrix[change.kind];
  return { kind: change.kind, ...classification, requiredEvidence: [...new Set(classification.requiredEvidence)] };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rejectSecretShapedFields(value, path = "input") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretShapedFields(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (/^\s*(?:Bearer|Basic)\s+/i.test(value)) {
      throw new Error(`authorization value is forbidden: ${path}`);
    }
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)
      || /(?:^|[?&;\s])(?:access[_-]?token|api[_-]?key|authorization|cookie|password|secret|token)\s*[=:]\s*[^\s&;]+/i.test(value)
      || /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)
    ) {
      throw new Error(`secret-pattern value is forbidden: ${path}`);
    }
    try {
      const parsed = new URL(value);
      if (parsed.username || parsed.password) throw new Error(`URL userinfo is forbidden: ${path}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("URL userinfo")) throw error;
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (/(?:authorization|cookie|credential|api[-_]?key|token|password|secret)/i.test(key)) {
      throw new Error(`secret-shaped field is forbidden: ${field}`);
    }
    if (/(?:connection|database).*url|(?:connectionUrl|databaseUrl)$/i.test(key)) {
      throw new Error(`connection URL field is forbidden: ${field}`);
    }
    if (typeof entry === "string" && /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i.test(entry)) {
      throw new Error(`connection URL value is forbidden: ${field}`);
    }
    rejectSecretShapedFields(entry, field);
  }
}

function requireReceiptPolicy(policy, name) {
  if (!policy || typeof policy !== "object") throw new Error(`${name} policy record is required`);
  assertOnlyKeys(policy, ["evidence", "evidenceLinks", "evidencePaths", "expiresAt", "owner", "reviewExpiresAt", "verdict"], `${name} policy`);
  if (!["approved", "blocked"].includes(policy.verdict)) throw new Error(`${name} verdict must be approved or blocked`);
  if (!String(policy.owner ?? "").trim()) throw new Error(`${name} owner is required`);
  if (durableEvidence(policy).length === 0) throw new Error(`${name} evidence is required`);
  const expiry = policy.reviewExpiresAt ?? policy.expiresAt;
  if (!expiry || Number.isNaN(Date.parse(expiry))) throw new Error(`${name} review expiry is required`);
}

function assertOnlyKeys(value, allowed, name) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${name} contains unknown fields: ${unexpected.join(", ")}`);
}

function validatePhase0Input(input) {
  assertOnlyKeys(input, [
    "databaseMigrationState", "deployedArtifact", "deployedRuntime", "environmentFlags",
    "exactHead", "migrationLedger", "policies", "providerBaselines", "providerOwnership",
    "rollbackCommands", "verificationId", "workingTreeStatus",
  ], "Phase 0 input");
  if (input.workingTreeStatus !== "clean") throw new Error("workingTreeStatus must be clean");
  if (!Array.isArray(input.migrationLedger) || input.migrationLedger.length === 0) {
    throw new Error("migrationLedger must be a non-empty array");
  }
  const migrationIds = [];
  for (const entry of input.migrationLedger) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("migrationLedger entry must be an object");
    assertOnlyKeys(entry, ["id", "status"], "migrationLedger entry");
    if (!/^20260720\d{6}(?:_[a-z0-9_]+)?(?:\.sql)?$/i.test(String(entry.id ?? ""))) {
      throw new Error("migrationLedger entry id is invalid");
    }
    if (!["observed", "applied", "pending", "blocked", "rolled_back"].includes(entry.status)) {
      throw new Error("migrationLedger entry status is invalid");
    }
    migrationIds.push(entry.id);
  }
  if (new Set(migrationIds).size !== migrationIds.length) throw new Error("migrationLedger IDs must be unique");
  if (!Array.isArray(input.providerOwnership) || input.providerOwnership.length === 0) {
    throw new Error("providerOwnership must be a non-empty array");
  }
  const providers = [];
  for (const entry of input.providerOwnership) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("providerOwnership entry must be an object");
    assertOnlyKeys(entry, ["provider", "writerRuntime"], "providerOwnership entry");
    if (!["greenhouse", "recruitee", "nicoka"].includes(entry.provider)) {
      throw new Error("providerOwnership provider is not registered");
    }
    if (!["none", "typescript", "python"].includes(entry.writerRuntime)) {
      throw new Error("providerOwnership writerRuntime is invalid");
    }
    providers.push(entry.provider);
  }
  if (new Set(providers).size !== providers.length) throw new Error("providerOwnership providers must be unique");
  if (!Array.isArray(input.environmentFlags) || input.environmentFlags.length === 0) {
    throw new Error("environmentFlags must be a non-empty array");
  }
  const flagNames = [];
  for (const flag of input.environmentFlags) {
    if (!flag || typeof flag !== "object" || Array.isArray(flag)) throw new Error("environmentFlags entry must be an object");
    if (Object.hasOwn(flag, "value")) throw new Error("environmentFlags must contain flag names and redacted states only");
    assertOnlyKeys(flag, ["name", "state"], "environmentFlags entry");
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(String(flag.name ?? "")) || !/^redacted(?::[a-z0-9_-]+)?$/i.test(String(flag.state ?? ""))) {
      throw new Error("environmentFlags must contain flag names and redacted states only");
    }
    flagNames.push(flag.name);
  }
  if (new Set(flagNames).size !== flagNames.length) throw new Error("environmentFlags names must be unique");
  if (!Array.isArray(input.rollbackCommands) || input.rollbackCommands.length === 0) {
    throw new Error("rollbackCommands must be a non-empty array");
  }
  const rollbackIds = [];
  for (const command of input.rollbackCommands) {
    if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("rollbackCommands entry must be an object");
    assertOnlyKeys(command, ["evidence", "id"], "rollbackCommands entry");
    if (!/^[a-z0-9][a-z0-9_-]{2,127}$/.test(String(command.id ?? ""))) throw new Error("rollbackCommands id is invalid");
    if (durableEvidence(command).length === 0) throw new Error("rollbackCommands evidence is required");
    rollbackIds.push(command.id);
  }
  if (new Set(rollbackIds).size !== rollbackIds.length) throw new Error("rollbackCommands IDs must be unique");
  if (!input.policies || typeof input.policies !== "object" || Array.isArray(input.policies)) {
    throw new Error("Phase 0 policies are required");
  }
  assertOnlyKeys(input.policies, ["candidateMandatePolicy", "inventoryAccess", "privacyBasis", "submissionAuthority"], "Phase 0 policies");
}

export function defaultAtsPhase0ReceiptOutput(verificationId) {
  if (!/^[a-z0-9][a-z0-9-]{7,48}$/.test(String(verificationId))) {
    throw new Error("verificationId must be valid before deriving the Phase 0 output path");
  }
  return `.omx/verification/ats-phase0-${verificationId}.json`;
}

export function createAtsPhase0Receipt(input = {}, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Phase 0 input must be an object");
  rejectSecretShapedFields(input);
  for (const field of ["exactHead", "workingTreeStatus", "migrationLedger", "providerOwnership", "environmentFlags", "rollbackCommands"]) {
    if (input[field] === undefined || input[field] === null) throw new Error(`Phase 0 ${field} observation is required`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(input.exactHead))) throw new Error("Phase 0 exactHead must be a lowercase 40-character commit SHA");
  validatePhase0Input(input);
  const policies = input.policies ?? {};
  for (const name of ["inventoryAccess", "submissionAuthority", "candidateMandatePolicy", "privacyBasis"]) {
    requireReceiptPolicy(policies[name], name);
  }
  const verificationId = options.verificationId ?? input.verificationId ?? createVerificationId();
  if (!/^[a-z0-9][a-z0-9-]{7,48}$/.test(String(verificationId))) throw new Error("invalid Phase 0 verificationId");
  const observations = structuredClone(input);
  delete observations.verificationId;
  for (const field of ["deployedRuntime", "deployedArtifact", "databaseMigrationState", "providerBaselines"]) {
    if (observations[field] === undefined || observations[field] === null) {
      observations[field] = { status: "BLOCKED_EXTERNAL", reason: `${field} was not observed by this local receipt` };
    }
  }
  return {
    version: ATS_PHASE0_RECEIPT_VERSION,
    verificationId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    exactHead: input.exactHead,
    canonicalInputSha256: sha256(canonicalJson(input)),
    observations,
    readinessStatus: Object.values(observations).some((entry) => entry?.status === "BLOCKED_EXTERNAL")
      ? "BLOCKED_EXTERNAL"
      : "EVIDENCE_CAPTURED",
    safeguards: {
      remoteInspectionPerformed: false,
      productionMutationPerformed: false,
      secretsAccepted: false,
    },
  };
}

function currentApprovedPolicy(policy, name, failures, now, input, evidenceRoot, trust) {
  if (policy?.verdict !== "approved") failures.push(`${name} must be approved`);
  if (!String(policy?.owner ?? "").trim()) failures.push(`${name} owner is required`);
  requireActivationEvidence(policy, input, evidenceRoot, `${name}_policy`, failures, trust);
  const expiry = policy?.reviewExpiresAt ?? policy?.expiresAt;
  if (!expiry || Number.isNaN(Date.parse(expiry))) failures.push(`${name} review expiry is required`);
  else if (Date.parse(expiry) <= now) failures.push(`${name} is expired`);
}

function validateReleaseAttestationEvidence(attestation, evidenceRoot, failures) {
  if (
    attestation?.version !== RELEASE_ATTESTATION_VERSION
    || attestation?.readinessStatus !== "ATTESTED_READY"
    || !/^[0-9a-f]{40}$/.test(String(attestation?.releaseHead ?? ""))
    || !/^[0-9a-f]{64}$/.test(String(attestation?.deployedArtifactDigest ?? ""))
    || !Array.isArray(attestation?.externalBlockDischarges)
  ) {
    failures.push("release attestation is incomplete or not ATTESTED_READY");
    return;
  }
  let manifest;
  try {
    manifest = containedEvidenceDescriptor(attestation.selectedManifest, evidenceRoot).json;
    const selected = validateSelectedManifest(manifest);
    if (selected.exactHead !== attestation.releaseHead) {
      failures.push("selected manifest exactHead does not match the release attestation");
    }
  } catch (error) {
    failures.push(`selected manifest evidence is invalid: ${error.message}`);
    return;
  }
  const observedCodes = [];
  for (const descriptor of attestation.externalBlockDischarges) {
    try {
      const discharge = containedEvidenceDescriptor(descriptor, evidenceRoot).json;
      const allowedKeys = ["code", "deployedArtifactDigest", "observedAt", "releaseHead", "status", "version"];
      if (!discharge || typeof discharge !== "object" || Array.isArray(discharge)
        || Object.keys(discharge).sort().join(",") !== allowedKeys.sort().join(",")) {
        throw new Error("schema is invalid");
      }
      if (discharge?.version !== EXTERNAL_DISCHARGE_VERSION) throw new Error("version is invalid");
      if (!ALLOWED_EXTERNAL_BLOCKS.has(discharge?.code)) throw new Error("code is invalid");
      if (discharge.status !== "discharged") throw new Error("status is not discharged");
      if (discharge.releaseHead !== attestation.releaseHead) throw new Error("releaseHead mismatch");
      if (discharge.deployedArtifactDigest !== attestation.deployedArtifactDigest) {
        throw new Error("deployedArtifactDigest mismatch");
      }
      if (!discharge.observedAt || Number.isNaN(Date.parse(discharge.observedAt))) {
        throw new Error("observedAt is invalid");
      }
      observedCodes.push(discharge.code);
    } catch (error) {
      failures.push(`external discharge evidence is invalid: ${error.message}`);
    }
  }
  const missing = [...ALLOWED_EXTERNAL_BLOCKS].filter((code) => !observedCodes.includes(code));
  if (missing.length) failures.push(`missing mandatory external discharges: ${missing.join(", ")}`);
  if (new Set(observedCodes).size !== observedCodes.length) failures.push("external discharge codes must be unique");
  if (observedCodes.length !== ALLOWED_EXTERNAL_BLOCKS.size) {
    failures.push("exactly one discharge for each mandatory external block is required");
  }
}

function validateShadowScorecard(scorecard, input, evidenceRoot) {
  if (!scorecard || typeof scorecard !== "object" || Array.isArray(scorecard)) throw new Error("scorecard must be an object");
  assertOnlyKeys(scorecard, [
    "canonicalWritesEnabled", "countryCode", "evidenceDigest", "policyDigest", "provider",
    "reconciliation", "runIds", "runs", "schemaVersion", "tenantId", "verdict",
  ], "shadow scorecard");
  const provider = String(input.provider ?? "").trim();
  const tenantId = String(input.tenantId ?? "").trim().toLowerCase();
  const countryCode = String(input.countryCode ?? "").trim().toUpperCase();
  const policyDigest = String(input.policyDigest ?? "");
  if (
    scorecard.schemaVersion !== 1
    || scorecard.verdict !== "complete_shadow_ready"
    || scorecard.canonicalWritesEnabled !== false
    || scorecard.provider !== provider
    || String(scorecard.tenantId ?? "").toLowerCase() !== tenantId
    || String(scorecard.countryCode ?? "").toUpperCase() !== countryCode
    || scorecard.policyDigest !== policyDigest
  ) throw new Error("shadow scorecard scope or readiness fields are invalid");
  if (!tenantId || !/^[A-Z]{2}$/.test(countryCode) || !/^[0-9a-f]{64}$/.test(policyDigest)) {
    throw new Error("provider preflight shadow scope is invalid");
  }
  if (!Array.isArray(scorecard.runIds) || scorecard.runIds.length !== 2) {
    throw new Error("shadow scorecard must contain exactly two run IDs");
  }
  if (scorecard.runIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(scorecard.runIds).size !== 2) {
    throw new Error("shadow scorecard run IDs must be non-empty and unique");
  }
  if (!Array.isArray(scorecard.runs) || scorecard.runs.length !== 2) {
    throw new Error("shadow scorecard must seal exactly two run artifacts");
  }
  scorecard.runs.forEach((descriptor, index) => {
    const run = containedEvidenceDescriptor(descriptor, evidenceRoot).json;
    if (!run || typeof run !== "object" || Array.isArray(run)) throw new Error("shadow run must be an object");
    assertOnlyKeys(run, [
      "canonicalWritesEnabled", "capturedAt", "complete", "countryCode", "jobs",
      "policyDigest", "provider", "runId", "schemaVersion", "tenantId",
    ], "shadow run");
    if (
      run.schemaVersion !== SHADOW_RUN_VERSION
      || run.runId !== scorecard.runIds[index]
      || run.provider !== provider
      || String(run.tenantId ?? "").toLowerCase() !== tenantId
      || String(run.countryCode ?? "").toUpperCase() !== countryCode
      || run.policyDigest !== policyDigest
      || run.complete !== true
      || run.canonicalWritesEnabled !== false
      || !run.capturedAt
      || Number.isNaN(Date.parse(run.capturedAt))
      || !Array.isArray(run.jobs)
    ) throw new Error("shadow run scope or completeness is invalid");
    const jobIds = run.jobs.map((job) => String(job?.externalId ?? ""));
    if (jobIds.some((id) => !id) || new Set(jobIds).size !== jobIds.length) {
      throw new Error("shadow run external IDs must be non-empty and unique");
    }
  });
  if (!Array.isArray(scorecard.reconciliation) || scorecard.reconciliation.length !== 1) {
    throw new Error("shadow scorecard must contain exactly one reconciliation");
  }
  const reconciliation = scorecard.reconciliation[0];
  if (!reconciliation || typeof reconciliation !== "object" || Array.isArray(reconciliation)) {
    throw new Error("shadow scorecard reconciliation is malformed");
  }
  assertOnlyKeys(reconciliation, ["additions", "fromRunId", "removals", "toRunId", "updates"], "shadow reconciliation");
  if (
    reconciliation.fromRunId !== scorecard.runIds[0]
    || reconciliation.toRunId !== scorecard.runIds[1]
    || ["additions", "updates", "removals"].some((field) => (
      !Array.isArray(reconciliation[field])
      || reconciliation[field].some((id) => typeof id !== "string" || !id.trim())
      || new Set(reconciliation[field]).size !== reconciliation[field].length
    ))
  ) throw new Error("shadow scorecard reconciliation does not match its run IDs");
  if (!/^[0-9a-f]{64}$/.test(String(scorecard.evidenceDigest ?? ""))) {
    throw new Error("shadow scorecard evidenceDigest is invalid");
  }
  const { evidenceDigest, ...evidence } = scorecard;
  if (sha256(canonicalJson(evidence)) !== evidenceDigest) throw new Error("shadow scorecard evidenceDigest mismatch");
}

function validateWriterOwnership(descriptor, input, evidenceRoot) {
  const evidence = containedEvidenceDescriptor(descriptor, evidenceRoot).json;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("writer ownership evidence must be an object");
  }
  assertOnlyKeys(evidence, [
    "countryCode", "observedAt", "ownershipEpoch", "policyDigest", "previousWriterRuntime",
    "provider", "releaseHead", "schemaVersion", "simultaneousCanonicalWriters", "status",
    "tenantId", "throughNone", "writerRuntime",
  ], "writer ownership evidence");
  const scope = activationScope(input);
  const expectedWriter = "typescript";
  const writerUnchanged = input.currentVerdict !== "blocked";
  if (
    evidence.schemaVersion !== WRITER_OWNERSHIP_VERSION
    || evidence.status !== "observed"
    || evidence.provider !== scope.provider
    || String(evidence.tenantId ?? "").toLowerCase() !== scope.tenantId
    || String(evidence.countryCode ?? "").toUpperCase() !== scope.countryCode
    || evidence.policyDigest !== scope.policyDigest
    || evidence.releaseHead !== scope.releaseHead
    || evidence.writerRuntime !== expectedWriter
    || (writerUnchanged
      ? evidence.previousWriterRuntime !== "typescript" || evidence.throughNone !== false
      : !["none", "python"].includes(evidence.previousWriterRuntime) || evidence.throughNone !== true)
    || evidence.simultaneousCanonicalWriters !== false
    || !Number.isInteger(evidence.ownershipEpoch)
    || evidence.ownershipEpoch < 1
    || !evidence.observedAt
    || Number.isNaN(Date.parse(evidence.observedAt))
  ) throw new Error("writer ownership scope, epoch, or one-writer state is invalid");
}

function validateActivationTransition(input, evidenceRoot, failures, trust) {
  const requirements = {
    inventory_canary_ready: {
      from: "blocked",
      gates: ["prior_state_receipt", "review", "ultraqa"],
    },
    inventory_active: {
      from: "inventory_canary_ready",
      gates: ["canary_receipt", "observation", "review", "ultraqa"],
    },
    inventory_manual: {
      from: "inventory_active",
      gates: ["prior_state_receipt", "review", "ultraqa"],
    },
    application_canary_ready: {
      from: "inventory_active",
      gates: ["prior_state_receipt", "review", "ultraqa"],
    },
    application_active: {
      from: "application_canary_ready",
      gates: ["canary_receipt", "observation", "review", "ultraqa"],
    },
  };
  const requirement = requirements[input.targetVerdict];
  if (!requirement) return;
  if (input.currentVerdict !== requirement.from) {
    failures.push(`${input.targetVerdict} requires currentVerdict ${requirement.from}`);
  }
  const prerequisites = input.transitionEvidence;
  if (!prerequisites || typeof prerequisites !== "object" || Array.isArray(prerequisites)) {
    failures.push(`${input.targetVerdict} transitionEvidence is required`);
    return;
  }
  const unexpected = Object.keys(prerequisites).filter((key) => !requirement.gates.includes(key));
  if (unexpected.length) failures.push(`transitionEvidence contains unknown gates: ${unexpected.join(", ")}`);
  for (const gate of requirement.gates) {
    try {
      validateActivationEvidence(
        prerequisites[gate],
        input,
        evidenceRoot,
        `${input.targetVerdict}_${gate}`,
        trust,
      );
    } catch (error) {
      failures.push(`${input.targetVerdict} ${gate} gate is invalid: ${error.message}`);
    }
  }
}

export function evaluateProviderActivationPreflight(input = {}, options = {}) {
  const failures = [];
  const evidenceRoot = options.evidenceRoot ?? process.cwd();
  const now = input.now === undefined ? Date.now() : Date.parse(input.now);
  if (Number.isNaN(now)) failures.push("now must be a valid timestamp when provided");
  const trust = {
    key: options.trustedAttestationKey ?? process.env.JOB_SUPPLY_ATTESTATION_HMAC_KEY,
    issuer: options.trustedAttestationIssuer ?? process.env.JOB_SUPPLY_ATTESTATION_ISSUER,
    workflowId: options.trustedWorkflowId ?? process.env.JOB_SUPPLY_ATTESTATION_WORKFLOW_ID,
    workflowRunId: options.trustedWorkflowRunId ?? process.env.JOB_SUPPLY_ATTESTATION_WORKFLOW_RUN_ID,
    now,
    maxAgeMs: options.maxEvidenceAgeMs ?? 24 * 60 * 60 * 1000,
    maxFutureSkewMs: options.maxFutureSkewMs ?? 5 * 60 * 1000,
    evidenceIds: new Set(),
    runKinds: new Set(),
  };
  const provider = String(input.provider ?? "").trim();
  const targetVerdict = input.targetVerdict;
  const allowedTargets = new Set([
    "inventory_canary_ready", "inventory_active", "application_canary_ready",
    "application_active", "inventory_manual", "blocked",
  ]);
  if (!new Set(["greenhouse", "recruitee", "nicoka"]).has(provider)) {
    failures.push("provider must be greenhouse, recruitee, or nicoka");
  }
  if (!allowedTargets.has(targetVerdict)) failures.push("targetVerdict is missing or unsupported");
  if (targetVerdict === "blocked") failures.push("blocked target cannot activate a provider");
  let attestation = null;
  try {
    attestation = containedEvidenceDescriptor(input.releaseAttestation, evidenceRoot).json;
  } catch (error) {
    failures.push(`sealed release attestation is required: ${error.message}`);
  }
  validateReleaseAttestationEvidence(attestation, evidenceRoot, failures);
  const scopedInput = { ...input, releaseAttestation: attestation };
  currentApprovedPolicy(input.inventoryAccess, "inventoryAccess", failures, now, scopedInput, evidenceRoot, trust);
  if (input.killSwitches?.providerArmed !== true) failures.push("provider kill switch is not armed");
  if (input.killSwitches?.tenantCountryArmed !== true) failures.push("tenant/country kill switch is not armed");
  if (input.rollback?.exercised !== true) failures.push("rollback was not exercised");
  requireActivationEvidence(input.rollback, scopedInput, evidenceRoot, "rollback_exercise", failures, trust);
  if (!String(input.rollback?.commandTranscriptId ?? "").trim()) failures.push("rollback command/transcript identifier is required");
  try {
    const scorecard = containedEvidenceDescriptor(input.shadowScorecard, evidenceRoot).json;
    validateShadowScorecard(scorecard, scopedInput, evidenceRoot);
  } catch (error) {
    failures.push(`sealed repeated shadow scorecard is required: ${error.message}`);
  }
  try {
    validateWriterOwnership(input.writerOwnership, scopedInput, evidenceRoot);
  } catch (error) {
    failures.push(`sealed writer ownership evidence is required: ${error.message}`);
  }
  validateActivationTransition(scopedInput, evidenceRoot, failures, trust);

  const applicationTarget = ["application_canary_ready", "application_active"].includes(targetVerdict);
  const inventoryTarget = ["inventory_canary_ready", "inventory_active", "inventory_manual"].includes(targetVerdict);
  if (["recruitee", "nicoka"].includes(provider) && applicationTarget) {
    failures.push(`${provider} supports inventory targets only`);
  }
  if (provider === "greenhouse" && !inventoryTarget && !applicationTarget) {
    failures.push("greenhouse target is unsupported");
  }
  if (applicationTarget) {
    if (provider !== "greenhouse") failures.push("application targets are available only for greenhouse");
    if (
      input.applicationCapability?.reviewed !== true
      || input.applicationCapability?.transport !== "hosted_candidate_form"
      || !input.applicationCapability?.evidence
    ) {
      failures.push("greenhouse application requires reviewed hosted_candidate_form capability evidence");
    }
    requireActivationEvidence(input.applicationCapability, scopedInput, evidenceRoot, "application_capability_review", failures, trust);
    currentApprovedPolicy(input.submissionAuthority, "submissionAuthority", failures, now, scopedInput, evidenceRoot, trust);
    currentApprovedPolicy(input.privacyBasis, "privacyBasis", failures, now, scopedInput, evidenceRoot, trust);
    if (input.nonProductionSubmission?.status !== "passed" || !input.nonProductionSubmission?.evidence) {
      failures.push("passed non-production submission evidence is required");
    }
    requireActivationEvidence(input.nonProductionSubmission, scopedInput, evidenceRoot, "non_production_submission", failures, trust);
  }
  if (targetVerdict === "inventory_manual") {
    if (
      input.manualDeepLink?.verified !== true
      || input.manualDeepLink?.environment !== "production"
      || !input.manualDeepLink?.evidence
    ) {
      failures.push("verified production manual deep-link evidence is required");
    }
    requireActivationEvidence(input.manualDeepLink, scopedInput, evidenceRoot, "manual_deep_link", failures, trust);
    if (input.applicationAutomationEnabled !== false) failures.push("application automation must remain disabled");
  }
  return { provider, targetVerdict, status: failures.length ? "BLOCKED" : "PASS", failures };
}

function fileEvidence(path, root = process.cwd()) {
  const absolute = resolve(root, path);
  const content = readFileSync(absolute);
  return { path, bytes: content.byteLength, sha256: sha256(content) };
}

export function collectArtifactEvidence(root = process.cwd()) {
  const migrationDir = resolve(root, "backend/db/migrations");
  const migrations = readdirSync(migrationDir)
    .filter((name) => MIGRATION_RE.test(name) || /^20260720\d+_.+\.down\.sql$/.test(name) || name === `${PGCRYPTO_COMPAT_MIGRATION}.down.sql`)
    .map((name) => `backend/db/migrations/${name}`);
  return [...new Set([...RELEASE_ARTIFACTS, ...migrations])]
    .sort()
    .map((path) => fileEvidence(path, root));
}

function executableEvidence(executable) {
  const located = spawnSync("which", [executable], {
    encoding: "utf8",
    env: sanitizedEnvironment(),
  });
  if (located.status !== 0) {
    return { executable, available: false };
  }
  const path = realpathSync(located.stdout.trim());
  const version = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: sanitizedEnvironment(),
  });
  return {
    executable,
    available: true,
    path,
    sha256: sha256(readFileSync(path)),
    version: redactSensitiveText(`${version.stdout ?? ""}${version.stderr ?? ""}`).trim(),
  };
}

export function collectToolEvidence(plan) {
  const executables = new Set(plan.commands.map((item) => item.executable));
  if (plan.databaseUrls) executables.add("psql");
  return [...executables].sort().map(executableEvidence);
}

function commandEvidence(item, result) {
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const evidence = {
    stdoutSha256: stdout ? sha256(stdout) : null,
    stderrSha256: stderr ? sha256(stderr) : null,
  };
  if (result.status !== 0 || !item.evidenceKind) return evidence;
  if (item.evidenceKind === "docker-image") {
    const image = JSON.parse(stdout)[0];
    const runtimeConfig = {
      user: image.Config?.User ?? null,
      workingDir: image.Config?.WorkingDir ?? null,
      entrypoint: image.Config?.Entrypoint ?? null,
      cmd: image.Config?.Cmd ?? null,
      exposedPorts: Object.keys(image.Config?.ExposedPorts ?? {}).sort(),
      environmentKeys: (image.Config?.Env ?? [])
        .map((entry) => entry.split("=", 1)[0])
        .sort(),
    };
    return {
      ...evidence,
      imageId: image.Id,
      repoDigests: image.RepoDigests ?? [],
      layerDigests: image.RootFS?.Layers ?? [],
      runtimeConfig,
      runtimeConfigSha256: sha256(JSON.stringify(runtimeConfig)),
    };
  }
  return { ...evidence, proof: JSON.parse(stdout.trim()) };
}

function cleanupDockerImage(tag) {
  const inspect = spawnSync("docker", ["image", "inspect", tag], {
    encoding: "utf8",
    env: sanitizedEnvironment(),
  });
  if (inspect.status !== 0) return { tag, wasPresent: false, removed: true };
  const imageId = JSON.parse(inspect.stdout)[0]?.Id ?? null;
  const removed = spawnSync("docker", ["image", "rm", "-f", tag], {
    encoding: "utf8",
    env: sanitizedEnvironment(),
  });
  return {
    tag,
    wasPresent: true,
    imageId,
    removed: removed.status === 0,
    outputSha256: sha256(`${removed.stdout ?? ""}${removed.stderr ?? ""}`),
  };
}

function attemptDatabaseCleanup(databaseUrls) {
  try {
    return {
      status: "passed",
      databases: cleanupDisposableDatabases(Object.values(databaseUrls)),
    };
  } catch (error) {
    return {
      status: "failed",
      databases: [],
      error: redactSensitiveText(error instanceof Error ? error.message : error),
    };
  }
}

function attemptDockerCleanup(tag) {
  try {
    const result = cleanupDockerImage(tag);
    return { status: result.removed ? "passed" : "failed", ...result };
  } catch (error) {
    return {
      status: "failed",
      tag,
      removed: false,
      error: redactSensitiveText(error instanceof Error ? error.message : error),
    };
  }
}

function run(plan) {
  const startedAt = new Date();
  const initial = repositoryAttestation();
  const results = [];
  let databaseProvisionAttempted = false;
  let dockerBuildAttempted = false;
  const expectedHead = plan.expectedHead ?? process.env.G015_EXPECTED_HEAD;
  if (expectedHead && !/^[0-9a-f]{40}$/i.test(expectedHead)) throw new Error("--expected-head must be a 40-character commit SHA");
  if (expectedHead && initial.head !== expectedHead) {
    results.push({ id: "repository-attestation", status: "failed", exitCode: 1, durationMs: 0, error: `HEAD ${initial.head} does not match expected ${expectedHead}` });
  } else if (!initial.clean) {
    results.push({ id: "repository-attestation", status: "failed", exitCode: 1, durationMs: 0, error: "working tree is not clean; verification cannot attest exact HEAD content" });
  } else {
    for (const item of plan.commands) {
      const commandStartedAt = Date.now();
      process.stdout.write(`\n[release:${item.id}] ${item.executable} ${item.args.join(" ")}\n`);
      if (item.id === "postgres-provision") databaseProvisionAttempted = true;
      if (item.id === "worker-docker-build") dockerBuildAttempted = true;
      const result = executeCommand(item);
      results.push({
        id: item.id,
        status: result.status === 0 ? "passed" : "failed",
        exitCode: result.status,
        signal: result.signal,
        durationMs: Date.now() - commandStartedAt,
        cwd: item.cwd,
        command: [item.executable, ...item.args],
        environment: Object.keys(item.env).length ? "[REDACTED]" : [],
        evidence: commandEvidence(item, result),
      });
      if (result.status !== 0) break;
    }
  }
  const cleanup = {
    database: databaseProvisionAttempted
      ? attemptDatabaseCleanup(plan.databaseUrls)
      : null,
    docker: dockerBuildAttempted ? attemptDockerCleanup(plan.dockerTag) : null,
  };
  const cleanupPassed =
    (!cleanup.database
      || (
        cleanup.database.status === "passed"
        && cleanup.database.databases.every((entry) => entry.dropped)
      ))
    && (!cleanup.docker || cleanup.docker.status === "passed");
  const final = repositoryAttestation();
  const contentUnchanged = initial.head === final.head && initial.contentDigest === final.contentDigest;
  const passed =
    initial.clean
    && final.clean
    && contentUnchanged
    && results.length === plan.commands.length
    && results.every((result) => result.status === "passed")
    && cleanupPassed;
  return {
    version: MANIFEST_VERSION, generatedAt: new Date().toISOString(), startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), profile: plan.profile,
    verificationId: plan.verificationId,
    exactHead: initial.head,
    expectedHead: expectedHead ?? null,
    repositoryAttestation: { initial, final, contentUnchanged },
    overallStatus: passed ? "passed" : "failed", readinessStatus: passed && plan.blockedExternal.length === 0 ? "READY" : passed ? "BLOCKED_EXTERNAL" : "FAILED",
    results,
    cleanup,
    tools: collectToolEvidence(plan),
    artifacts: collectArtifactEvidence(),
    blockedExternal: plan.blockedExternal,
    safeguards: {
      deploymentSideEffectsPerformedByVerifier: false,
      providerActivationPerformed: false,
      canonicalWriterTransferPerformed: false,
      applicationSubmissionPerformed: false,
      externalStateInspectedByVerifier: false,
    },
  };
}

export function resolveManifestOutput(path, root = process.cwd()) {
  const output = resolve(root, path);
  const verificationRoot = resolve(root, ".omx", "verification");
  const containment = relative(verificationRoot, output);
  if (!containment || containment.startsWith(`..${sep}`) || containment === ".." || resolve(verificationRoot, containment) !== output) {
    throw new Error("--output must be a new path contained under .omx/verification");
  }
  const rootRelative = relative(root, output);
  let cursor = root;
  for (const component of rootRelative.split(sep)) {
    cursor = resolve(cursor, component);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error("--output path must not traverse symbolic links");
    }
  }
  if (existsSync(output)) {
    throw new Error("--output must not already exist");
  }
  return output;
}

function writeManifest(path, manifest) {
  const output = resolveManifestOutput(path);
  mkdirSync(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    renameSync(temp, output);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

const direct = import.meta.url === `file://${process.argv[1]}`;
if (direct) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--internal-attest-clean") {
    const attestation = repositoryAttestation();
    if (!attestation.clean) throw new Error("working tree is not clean");
  } else if (argv[0] === "--internal-stack-policy-revision") {
    verifyStackPolicyRevision();
  } else if (argv[0] === "--internal-deployment-default-safety") {
    verifyDeploymentDefaults();
  } else if (argv[0] === "--internal-provision-databases") {
    console.log(JSON.stringify(provisionDisposableDatabases()));
  } else if (argv[0] === "--internal-disabled-state-proof") {
    console.log(JSON.stringify(verifyPostMigrationDisabledState()));
  } else if (argv[0] === "--attest-selection") {
    const options = parseNamedArgs(argv, ["manifest", "discharges", "artifact-digest", "release-head", "output"]);
    const manifestBytes = readFileSync(resolve(process.cwd(), options.manifest));
    const attestation = createReleaseAttestation({
      selectedManifest: { path: options.manifest, sha256: sha256(manifestBytes) },
      discharges: JSON.parse(readFileSync(resolve(process.cwd(), options.discharges), "utf8")),
      deployedArtifactDigest: options["artifact-digest"],
      releaseHead: options["release-head"],
    });
    writeManifest(options.output, attestation);
    console.log(JSON.stringify({ output: options.output, readinessStatus: attestation.readinessStatus }));
  } else if (argv[0] === "--provider-preflight") {
    const options = parseNamedArgs(
      ["provider-preflight-mode", "--provider-preflight", argv[1], ...argv.slice(2)],
      ["provider-preflight", "output"],
    );
    const evidence = evaluateProviderActivationPreflight(
      JSON.parse(readFileSync(resolve(process.cwd(), options["provider-preflight"]), "utf8")),
    );
    writeManifest(options.output, evidence);
    console.log(JSON.stringify({ output: options.output, status: evidence.status }));
    if (evidence.status === "BLOCKED") process.exitCode = 1;
  } else if (argv[0] === "--phase0-receipt") {
    if (!argv[1] || argv[1].startsWith("--")) throw new Error("--phase0-receipt requires an input JSON path");
    const outputOptions = argv.length > 2
      ? parseNamedArgs(["phase0-receipt-mode", ...argv.slice(2)], ["output"])
      : {};
    const receipt = createAtsPhase0Receipt(
      JSON.parse(readFileSync(resolve(process.cwd(), argv[1]), "utf8")),
    );
    const output = outputOptions.output ?? defaultAtsPhase0ReceiptOutput(receipt.verificationId);
    writeManifest(output, receipt);
    console.log(JSON.stringify({ output, readinessStatus: receipt.readinessStatus }));
  } else {
    const options = parseArgs(argv);
    const plan = buildReleaseVerificationPlan(options);
    const output = options.output ?? defaultReleaseManifestOutput(plan.verificationId);
    const manifest = options.planOnly
      ? {
          version: MANIFEST_VERSION,
          generatedAt: new Date().toISOString(),
          verificationId: plan.verificationId,
          profile: plan.profile,
          readinessStatus: "BLOCKED_EXTERNAL",
          commands: plan.commands.map(({ env: _env, ...item }) => item),
          blockedExternal: plan.blockedExternal,
        }
      : run(plan);
    writeManifest(output, manifest);
    console.log(JSON.stringify({ output, status: manifest.overallStatus ?? "planned", readinessStatus: manifest.readinessStatus }));
    if (manifest.overallStatus === "failed") process.exitCode = 1;
  }
}
