#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
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

const MANIFEST_VERSION = "job-supply-release-verification.v3";
const MIGRATION_RE = /^20260720\d+_.+\.sql$/;
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
];
const SUITE_NAMES = ["g002", "g003", "g004", "g010", "g011", "ledger", "g014"];
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
        ["audit", "--omit=dev", "--audit-level=critical"],
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
      blocked("DEPLOYMENT_NOT_PERFORMED", "deployment", "Vercel/Railway preview or production deployment is approval-gated and was not performed"),
      blocked("SOURCE_ACTIVATION_NOT_PERFORMED", "source", "provider/source activation and external source fetching were not performed"),
    ],
  };
}

export function isolatedDatabaseUrl(databaseUrl, suite) {
  const parsed = new URL(databaseUrl);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const suffix = String(suite).replace(/[^a-zA-Z0-9_]/g, "_");
  const maximumPrefixLength = Math.max(1, 63 - suffix.length - 1);
  parsed.pathname = `/${name.slice(0, maximumPrefixLength)}_${suffix}`;
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

function disposableDatabaseUrlsFromEnvironment() {
  const urls = DATABASE_ENV_NAMES.map((name) => process.env[name]).filter(Boolean);
  if (urls.length !== DATABASE_ENV_NAMES.length) {
    throw new Error("all seven isolated PostgreSQL database URLs are required");
  }
  if (new Set(urls).size !== DATABASE_ENV_NAMES.length) {
    throw new Error("PostgreSQL release suites require seven distinct database URLs");
  }
  for (const url of urls) {
    assertDisposableDatabase(url, true);
    const name = databaseName(url);
    if (!/_\d{14}_\d+_[a-f0-9]{8}_(?:g002|g003|g004|g010|g011|ledger|g014)$/.test(name)) {
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
    if (!/_\d{14}_\d+_[a-f0-9]{8}_(?:g002|g003|g004|g010|g011|ledger|g014)$/.test(name)) {
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
  return { migrations: ups, workerDockerValidated: true, backendRailwayValidated: true };
}

function parseArgs(argv) {
  const options = { profile: "repository", output: ".omx/verification/job-supply-release-manifest.json", includeFrontend: false, includeDocker: false, planOnly: false, expectedHead: process.env.G015_EXPECTED_HEAD ?? null, databaseUrl: process.env.G015_TEST_DATABASE_URL ?? null, allowDisposableDatabase: process.env.G015_ALLOW_DISPOSABLE_DATABASE === "true" };
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileEvidence(path, root = process.cwd()) {
  const absolute = resolve(root, path);
  const content = readFileSync(absolute);
  return { path, bytes: content.byteLength, sha256: sha256(content) };
}

export function collectArtifactEvidence(root = process.cwd()) {
  const migrationDir = resolve(root, "backend/db/migrations");
  const migrations = readdirSync(migrationDir)
    .filter((name) => MIGRATION_RE.test(name) || /^20260720\d+_.+\.down\.sql$/.test(name))
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
    safeguards: { productionDeploymentPerformed: false, providerActivationPerformed: false, canonicalWriterTransferPerformed: false, applicationSubmissionPerformed: false, externalStateInspected: false },
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
  } else {
    const options = parseArgs(argv);
    const plan = buildReleaseVerificationPlan(options);
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
    writeManifest(options.output, manifest);
    console.log(JSON.stringify({ output: options.output, status: manifest.overallStatus ?? "planned", readinessStatus: manifest.readinessStatus }));
    if (manifest.overallStatus === "failed") process.exitCode = 1;
  }
}
