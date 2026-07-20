#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const MANIFEST_VERSION = "job-supply-release-verification.v3";
const MIGRATION_RE = /^20260720\d+_.+\.sql$/;
const PYTHON_EXCEPTION_RE = /^\s*#\s*stack-policy:\s*python-exception=(.{12,})\s*$/im;
const DISPOSABLE_DB_RE = /(?:^|_)(?:test|disposable)(?:$|_)/i;
const HEAD_RE = /^[0-9a-f]{40}$/;
const OUTPUT_ROOT = ".omx/verification";
const SAFE_CHILD_ENV_KEYS = [
  "ALL_PROXY",
  "CI",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "NO_PROXY",
  "PATH",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
];
const REQUIRED_DOCKERIGNORE_RULES = [
  ".git",
  ".omx",
  "**/node_modules",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "*.env",
  "**/*credentials*.json",
  "**/*token*.json",
  "backend/.browser-profile",
  "backend/sr-browser-profile",
  "backend/.browser-secrets.env",
  "backend/.secrets",
  "backend/sr-storage-state*.json",
];
const POSTGRES_SUITES = [
  { id: "g002", env: "G002_TEST_DATABASE_URL", file: "tests/g002-postgres.integration.test.ts" },
  { id: "g003", env: "G003_TEST_DATABASE_URL", file: "tests/g003-postgres-runtime.integration.test.ts" },
  { id: "g004", env: "G004_TEST_DATABASE_URL", file: "tests/g004-postgres-runtime.integration.test.ts" },
  { id: "g010", env: "G010_TEST_DATABASE_URL", file: "tests/g010-provider-ownership-postgres.integration.test.ts" },
  { id: "g011", env: "G011_TEST_DATABASE_URL", file: "tests/g011-ats-tenant-registration-postgres.integration.test.ts" },
  {
    id: "ledger",
    env: "JOB_INGESTION_LEDGER_TEST_DATABASE_URL",
    file: "tests/job-ingestion-ledger-postgres.integration.test.ts",
  },
  { id: "g014", env: "G014_TEST_DATABASE_URL", file: "tests/g014-source-trial-postgres.integration.test.ts" },
];
const ACTIVATION_TABLES = [
  "provider_registry",
  "worker_schedules",
  "python_ingestion_schedules",
  "source_policy",
  "career_sources",
  "source_trial_policies",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function orderedFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const name of readdirSync(root).sort()) {
    const path = resolve(root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`attested tree cannot contain symlinks: ${path}`);
    if (stat.isDirectory()) files.push(...orderedFiles(path));
    else if (stat.isFile()) files.push(path);
  }
  return files;
}

export function hashTree(root, repositoryRoot = process.cwd()) {
  const absoluteRoot = resolve(repositoryRoot, root);
  const entries = orderedFiles(absoluteRoot).map((path) => ({
    path: relative(repositoryRoot, path).split(sep).join("/"),
    sha256: sha256File(path),
    bytes: statSync(path).size,
  }));
  return {
    root: relative(repositoryRoot, absoluteRoot).split(sep).join("/"),
    files: entries.length,
    sha256: sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\0${entry.bytes}\n`).join("")),
  };
}

export function assertExpectedHead(expectedHead, actualHead) {
  if (!HEAD_RE.test(expectedHead ?? "")) {
    throw new Error("--expected-head must be a full 40-character lowercase Git SHA");
  }
  if (actualHead !== expectedHead) {
    throw new Error(`expected HEAD ${expectedHead}, found ${actualHead}`);
  }
}

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

export function deriveIsolatedDatabaseUrls(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const base = decodeURIComponent(parsed.pathname.replace(/^\//, ""))
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffixes = [...POSTGRES_SUITES.map(({ id }) => id), "activation"];
  return Object.fromEntries(suffixes.map((suffix) => {
    const hash = sha256(`${base}:${suffix}`).slice(0, 8);
    const prefix = base.slice(0, Math.max(1, 63 - suffix.length - hash.length - 2));
    const url = new URL(parsed);
    url.pathname = `/${prefix}_${suffix}_${hash}`;
    return [suffix, url.toString()];
  }));
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
  return redacted
    .replace(/\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/\b(?:password|token|secret|api[_-]?key)=\S+/gi, (match) => `${match.split("=")[0]}=[REDACTED]`);
}

export function buildChildEnvironment(overrides = {}, source = process.env) {
  const environment = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null) environment[key] = String(value);
  }
  return environment;
}

function blocked(code, category, message) {
  return { status: "BLOCKED_EXTERNAL", code, category, message };
}

function command(id, executable, args, options = {}) {
  return {
    id,
    executable,
    args,
    cwd: options.cwd ?? ".",
    env: options.env ?? {},
    redactEnvironment: options.redactEnvironment ?? false,
    captureJson: options.captureJson ?? false,
    cleanup: options.cleanup ?? false,
  };
}

export function buildReleaseVerificationPlan(options = {}) {
  const full = options.profile === "full";
  const includeFrontend = full || options.includeFrontend === true;
  const includeDocker = full || options.includeDocker === true;
  const databaseUrl = options.databaseUrl?.trim() || null;
  const expectedHead = options.expectedHead?.trim() || null;
  if (expectedHead) assertExpectedHead(expectedHead, expectedHead);
  assertDisposableDatabase(databaseUrl, options.allowDisposableDatabase === true);

  const expectedEnv = expectedHead ? { G015_EXPECTED_HEAD: expectedHead } : {};
  const commands = [
    command(
      "repository-attestation",
      "node",
      ["scripts/verify-job-supply-release.mjs", "--internal-attest-clean"],
      { env: expectedEnv },
    ),
    command("frozen-install", "bun", ["install", "--frozen-lockfile"]),
    command("typecheck", "bun", ["run", "typecheck"]),
    command("lint", "bun", ["run", "lint"]),
    command("tests", "bun", ["run", "test"]),
    command("build", "bun", ["run", "build"]),
    command("release-contracts", "bun", ["test", "tests/g015-release-readiness.test.ts"]),
    command("stack-policy-revision", "node", ["scripts/verify-job-supply-release.mjs", "--internal-stack-policy-revision"]),
    command(
      "deployment-default-safety",
      "node",
      ["scripts/verify-job-supply-release.mjs", "--internal-deployment-default-safety"],
    ),
    command("diff-check", "git", ["diff", "--check"]),
  ];

  if (includeFrontend) {
    commands.push(
      command("legacy-frontend-frozen-install", "npm", ["ci", "--legacy-peer-deps"], { cwd: "frontend" }),
      command("legacy-frontend-build", "npm", ["run", "build"], { cwd: "frontend", env: { CI: "false" } }),
      command(
        "legacy-frontend-artifact-proof",
        "node",
        ["scripts/verify-job-supply-release.mjs", "--internal-frontend-proof"],
        { captureJson: true },
      ),
    );
  }
  let dockerTag = null;
  if (includeDocker) {
    commands.push(command(
      "worker-docker-proof",
      "node",
      ["scripts/verify-job-supply-release.mjs", "--internal-docker-proof"],
      { env: expectedEnv, captureJson: true },
    ));
  }
  let databaseUrls = null;
  if (databaseUrl) {
    const urls = deriveIsolatedDatabaseUrls(databaseUrl);
    for (const suite of POSTGRES_SUITES) {
      commands.push(
        command(
          `postgres-${suite.id}-freshness`,
          "node",
          ["scripts/verify-job-supply-release.mjs", "--internal-database-freshness"],
          {
            env: {
              G015_SUITE_DATABASE_URL: urls[suite.id],
              G015_ALLOW_DISPOSABLE_DATABASE: "true",
            },
            redactEnvironment: true,
            captureJson: true,
          },
        ),
        command(`postgres-${suite.id}`, "bun", ["test", "--timeout", "30000", suite.file], {
          env: { [suite.env]: urls[suite.id] },
          redactEnvironment: true,
        }),
      );
    }
    commands.push(
      command(
        "postgres-activation-freshness",
        "node",
        ["scripts/verify-job-supply-release.mjs", "--internal-database-freshness"],
        {
          env: {
            G015_SUITE_DATABASE_URL: urls.activation,
            G015_ALLOW_DISPOSABLE_DATABASE: "true",
          },
          redactEnvironment: true,
          captureJson: true,
        },
      ),
      command(
        "postgres-disabled-activation-proof",
        "node",
        ["scripts/verify-job-supply-release.mjs", "--internal-disabled-activation-proof"],
        {
          env: {
            G015_SUITE_DATABASE_URL: urls.activation,
            G015_ALLOW_DISPOSABLE_DATABASE: "true",
          },
          redactEnvironment: true,
          captureJson: true,
        },
      ),
    );
  }
  return {
    profile: full ? "full" : "repository",
    expectedHead,
    databaseUrls: databaseUrl ? deriveIsolatedDatabaseUrls(databaseUrl) : null,
    commands,
    blockedExternal: [
      ...(!includeFrontend
        ? [blocked("FRONTEND_NOT_REQUESTED", "repository", "legacy frontend build not requested; use --with-frontend or --profile full")]
        : []),
      ...(!includeDocker
        ? [blocked("DOCKER_NOT_REQUESTED", "repository", "worker Docker build not requested; use --with-docker or --profile full")]
        : []),
      ...(!databaseUrl
        ? [blocked("DATABASE_NOT_PROVIDED", "infrastructure", "PostgreSQL release matrix requires G015_TEST_DATABASE_URL plus --allow-disposable-database")]
        : []),
      blocked("DEPLOYMENT_NOT_PERFORMED", "deployment", "Vercel/Railway preview or production deployment is approval-gated and was not performed"),
      blocked("SOURCE_ACTIVATION_NOT_PERFORMED", "source", "provider/source activation and external source fetching were not performed"),
    ],
  };
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: buildChildEnvironment(),
  });
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
    contentDigest: sha256(`${head}\0${trackedDiff}\0${status}`),
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

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function stripFunctionDefinitions(sql) {
  return sql.replace(
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*?\n\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$;\s*/gi,
    " ",
  );
}

export function findUnsafeActivationStatements(sql, options = {}) {
  const source = stripSqlComments(options.migrationTimeOnly ? stripFunctionDefinitions(sql) : sql);
  const tables = ACTIVATION_TABLES.join("|");
  const activationColumns = "(?:enabled|is_enabled|transport_enabled|incremental_enabled|backfill_enabled|trial_enabled)";
  const findings = [];
  const patterns = [
    {
      code: "literal_update_enablement",
      regex: new RegExp(`\\bUPDATE\\s+(?:public\\.)?(?:${tables})\\b[^;]*?\\bSET\\b[^;]*?\\b${activationColumns}\\s*=\\s*true\\b`, "gi"),
    },
    {
      code: "literal_insert_enablement",
      regex: new RegExp(`\\bINSERT\\s+INTO\\s+(?:public\\.)?(?:${tables})\\s*\\([^;]*?\\b${activationColumns}\\b[^;]*?\\)\\s*VALUES\\s*\\([^;]*?\\btrue\\b`, "gi"),
    },
    {
      code: "activation_rpc",
      regex: /\b(?:CALL|SELECT)\s+(?:worker_private\.)?(?:set_[a-z0-9_]*enabled|activate_[a-z0-9_]*)\s*\([^;]*?\btrue\b/gi,
    },
    {
      code: "writer_transfer",
      regex: /\bUPDATE\s+(?:public\.)?provider_registry\b[^;]*?\bSET\b[^;]*?\bwriter_runtime\s*=\s*'typescript'/gi,
    },
    {
      code: "writer_transfer",
      regex: /\bINSERT\s+INTO\s+(?:public\.)?provider_registry\s*\([^;]*?\bwriter_runtime\b[^;]*?\)\s*VALUES\s*\([^;]*?'typescript'/gi,
    },
  ];
  for (const { code, regex } of patterns) {
    if (regex.test(source)) findings.push(code);
  }
  return findings;
}

export function verifyDockerContext(root = process.cwd()) {
  const path = resolve(root, ".dockerignore");
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
    throw new Error("root .dockerignore must exist and must not be a symlink");
  }
  const rules = new Set(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  const missing = REQUIRED_DOCKERIGNORE_RULES.filter((rule) => !rules.has(rule));
  if (missing.length) throw new Error(`root .dockerignore lacks required exclusions: ${missing.join(", ")}`);
  return { path: ".dockerignore", sha256: sha256File(path), requiredRules: REQUIRED_DOCKERIGNORE_RULES };
}

export function verifyDeploymentDefaults(root = process.cwd()) {
  const migrationDir = resolve(root, "backend/db/migrations");
  const ups = readdirSync(migrationDir).filter((name) => MIGRATION_RE.test(name) && !name.endsWith(".down.sql")).sort();
  const downs = new Set(readdirSync(migrationDir).filter((name) => name.endsWith(".down.sql")));
  const missingDown = ups.filter((name) => !downs.has(name.replace(/\.sql$/, ".down.sql")));
  if (missingDown.length) throw new Error(`migrations missing down files: ${missingDown.join(", ")}`);
  const migrationHashes = [];
  for (const name of ups) {
    const path = resolve(migrationDir, name);
    const sql = readFileSync(path, "utf8");
    const findings = findUnsafeActivationStatements(sql, { migrationTimeOnly: true });
    if (findings.length) throw new Error(`${name} contains unsafe activation statements: ${findings.join(", ")}`);
    migrationHashes.push({ name, sha256: sha256File(path), down: name.replace(/\.sql$/, ".down.sql") });
  }

  const dockerfile = readFileSync(resolve(root, "apps/worker/Dockerfile"), "utf8");
  if (
    !/^USER\s+bun\s*$/m.test(dockerfile)
    || !/^CMD\s+\[\s*"[^"]+"(?:\s*,\s*"[^"]+")*\s*\]\s*$/m.test(dockerfile)
    || /^COPY\s+(?:--[^\s]+\s+)*(?:\.[^\s]*env|[^\s]*\.env(?:\.[^\s]+)?)(?:\s|$)/im.test(dockerfile)
  ) {
    throw new Error("worker Dockerfile must use USER bun, exec-form CMD, and never copy env files");
  }
  const dockerContext = verifyDockerContext(root);

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
  return {
    migrations: migrationHashes,
    workerDockerValidated: true,
    dockerContext,
    backendRailwayValidated: true,
  };
}

function runPsql(databaseUrl, args) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: buildChildEnvironment(),
  });
  if (result.status !== 0) {
    throw new Error(redactSensitiveText(result.stderr || result.stdout, [databaseUrl]));
  }
  return result.stdout.trim();
}

export function parseFreshnessProof(value) {
  const proof = typeof value === "string" ? JSON.parse(value) : value;
  if (
    typeof proof?.database !== "string"
    || !Number.isInteger(proof.userSchemas)
    || !Number.isInteger(proof.userRelations)
  ) {
    throw new Error("invalid database freshness proof");
  }
  if (proof.userSchemas !== 0 || proof.userRelations !== 0) {
    throw new Error(
      `disposable database ${proof.database} is not fresh/empty: ${proof.userSchemas} user schemas, ${proof.userRelations} user relations`,
    );
  }
  return proof;
}

export function verifyFreshDatabase(databaseUrl, explicitlyAllowed = true) {
  assertDisposableDatabase(databaseUrl, explicitlyAllowed);
  const output = runPsql(databaseUrl, [
    "-A",
    "-t",
    "-q",
    "-c",
    `SELECT json_build_object(
      'database', current_database(),
      'userSchemas', (
        SELECT count(*)::integer
        FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
          AND nspname !~ '^pg_toast'
      ),
      'userRelations', (
        SELECT count(*)::integer
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_toast'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      )
    )::text;`,
  ]);
  return parseFreshnessProof(output);
}

export function verifyDisabledActivationState(databaseUrl, explicitlyAllowed = true, root = process.cwd()) {
  assertDisposableDatabase(databaseUrl, explicitlyAllowed);
  runPsql(databaseUrl, ["-q", "-f", resolve(root, "backend/db/jobs_inventory_schema.sql")]);
  const migrationDir = resolve(root, "backend/db/migrations");
  const migrations = readdirSync(migrationDir)
    .filter((name) => MIGRATION_RE.test(name) && !name.endsWith(".down.sql"))
    .sort();
  for (const name of migrations) runPsql(databaseUrl, ["-q", "-f", resolve(migrationDir, name)]);
  const output = runPsql(databaseUrl, [
    "-A",
    "-t",
    "-q",
    "-c",
    `SELECT json_build_object(
      'enabledProviders', (SELECT count(*)::integer FROM public.provider_registry WHERE enabled),
      'typescriptWriterTransfers', (
        SELECT count(*)::integer FROM public.provider_registry
        WHERE writer_runtime = 'typescript' OR ownership_epoch <> 0 OR claims_required
      ),
      'enabledWorkerSchedules', (SELECT count(*)::integer FROM public.worker_schedules WHERE enabled),
      'enabledPythonSchedules', (SELECT count(*)::integer FROM public.python_ingestion_schedules WHERE enabled),
      'enabledSourcePolicies', (SELECT count(*)::integer FROM public.source_policy WHERE enabled),
      'enabledCareerSources', (
        SELECT count(*)::integer FROM public.career_sources
        WHERE enabled OR transport_enabled OR incremental_enabled OR backfill_enabled
      ),
      'enabledTrialPolicies', (SELECT count(*)::integer FROM public.source_trial_policies WHERE trial_enabled)
    )::text;`,
  ]);
  const proof = JSON.parse(output);
  const nonzero = Object.entries(proof).filter(([, value]) => value !== 0);
  if (nonzero.length) {
    throw new Error(`post-migration activation proof failed: ${JSON.stringify(Object.fromEntries(nonzero))}`);
  }
  return { ...proof, migrations };
}

function parseLastJsonLine(value) {
  const lines = String(value ?? "").trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  throw new Error("captured command did not emit JSON evidence");
}

export function executeCommand(
  item,
  output = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
) {
  const capture = item.redactEnvironment || item.captureJson;
  const environment = buildChildEnvironment(item.env);
  const result = spawnSync(item.executable, item.args, {
    cwd: resolve(process.cwd(), item.cwd),
    env: environment,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    shell: false,
  });
  if (!capture) return result;
  const secrets = Object.values(item.env);
  const stdout = redactSensitiveText(result.stdout, secrets);
  const stderr = redactSensitiveText(result.stderr, secrets);
  output.stdout(stdout);
  output.stderr(stderr);
  return {
    ...result,
    stdout,
    stderr,
    evidence: item.captureJson && result.status === 0 ? parseLastJsonLine(stdout) : undefined,
    outputDigest: sha256(`${stdout}\0${stderr}`),
  };
}

function executablePath(executable) {
  const result = spawnSync("which", [executable], {
    encoding: "utf8",
    env: buildChildEnvironment(),
  });
  if (result.status !== 0) return null;
  const path = result.stdout.trim().split(/\r?\n/)[0];
  return path ? realpathSync(path) : null;
}

export function collectToolAttestations(commands) {
  const executables = new Set(commands.map(({ executable }) => executable));
  if (commands.some(({ id }) => id === "worker-docker-proof")) executables.add("docker");
  if (commands.some(({ id }) => id.startsWith("postgres-"))) executables.add("psql");
  return [...executables].sort().map((executable) => {
    const path = executablePath(executable);
    if (!path) return { executable, available: false };
    const version = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      env: buildChildEnvironment(),
    });
    return {
      executable,
      available: true,
      path,
      sha256: sha256File(path),
      version: redactSensitiveText(version.stdout || version.stderr).trim().split(/\r?\n/)[0],
    };
  });
}

export function collectArtifactAttestation(root = process.cwd()) {
  const paths = [
    "scripts/verify-job-supply-release.mjs",
    "tests/g015-release-readiness.test.ts",
    ".dockerignore",
    "apps/worker/Dockerfile",
    "bun.lock",
    "frontend/package-lock.json",
  ];
  const files = Object.fromEntries(paths.map((path) => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) throw new Error(`required attestation artifact is missing: ${path}`);
    return [path, { sha256: sha256File(absolute), bytes: statSync(absolute).size }];
  }));
  const migrationDir = resolve(root, "backend/db/migrations");
  const migrations = readdirSync(migrationDir)
    .filter((name) => MIGRATION_RE.test(name) && !name.endsWith(".down.sql"))
    .sort()
    .map((name) => {
      const down = name.replace(/\.sql$/, ".down.sql");
      return {
        name,
        sha256: sha256File(resolve(migrationDir, name)),
        down,
        downSha256: sha256File(resolve(migrationDir, down)),
      };
    });
  return {
    files,
    migrations,
    frontendBuild: existsSync(resolve(root, "frontend/build"))
      ? hashTree("frontend/build", root)
      : null,
  };
}

export function verifyFrontendBuild(root = process.cwd()) {
  for (const path of ["frontend/build/index.html", "frontend/build/asset-manifest.json"]) {
    if (!existsSync(resolve(root, path))) throw new Error(`frontend build artifact missing: ${path}`);
  }
  return {
    packageLockSha256: sha256File(resolve(root, "frontend/package-lock.json")),
    build: hashTree("frontend/build", root),
  };
}

export function runDockerProof(expectedHead, root = process.cwd()) {
  assertExpectedHead(expectedHead, repositoryAttestation().head);
  const dockerContext = verifyDockerContext(root);
  const tempRoot = resolve(root, OUTPUT_ROOT);
  mkdirSync(tempRoot, { recursive: true });
  const tag = `hirly-worker:release-verification-${expectedHead.slice(0, 12)}-${process.pid}`;
  const iidFile = resolve(tempRoot, `docker-${process.pid}-${randomUUID()}.iid`);
  let imageId = null;
  try {
    const build = spawnSync(
      "docker",
      ["build", "--iidfile", iidFile, "-f", "apps/worker/Dockerfile", "-t", tag, "."],
      { cwd: root, stdio: "inherit", env: buildChildEnvironment() },
    );
    if (build.status !== 0) throw new Error(`Docker build failed with exit ${build.status}`);
    imageId = readFileSync(iidFile, "utf8").trim();
    const inspect = spawnSync(
      "docker",
      ["image", "inspect", tag, "--format", "{{json .Config}}"],
      { cwd: root, encoding: "utf8", env: buildChildEnvironment() },
    );
    if (inspect.status !== 0) throw new Error(inspect.stderr || "Docker inspect failed");
    const config = JSON.parse(inspect.stdout.trim());
    if (config.User !== "bun" || JSON.stringify(config.Cmd) !== JSON.stringify(["bun", "apps/worker/dist/main.js"])) {
      throw new Error(`Docker runtime config is unsafe: ${inspect.stdout.trim()}`);
    }
    return {
      tag,
      imageId,
      config: { user: config.User, cmd: config.Cmd },
      dockerContext,
    };
  } finally {
    if (imageId || existsSync(iidFile)) {
      spawnSync("docker", ["image", "rm", "--force", tag], {
        cwd: root,
        stdio: "ignore",
        env: buildChildEnvironment(),
      });
    }
    rmSync(iidFile, { force: true });
  }
}

export function runReleaseVerification(plan, dependencies = {}) {
  const attest = dependencies.attest ?? repositoryAttestation;
  const execute = dependencies.execute ?? executeCommand;
  const collectArtifacts = dependencies.collectArtifacts ?? collectArtifactAttestation;
  const collectTools = dependencies.collectTools ?? collectToolAttestations;
  const startedAt = new Date();
  const initial = attest();
  const results = [];
  let preflightError = null;
  try {
    assertExpectedHead(plan.expectedHead, initial.head);
    if (!initial.clean) throw new Error("working tree is not clean; verification cannot attest exact HEAD content");
  } catch (error) {
    preflightError = error instanceof Error ? error.message : String(error);
  }

  if (!preflightError) {
    for (const item of plan.commands) {
      const commandStartedAt = Date.now();
      process.stdout.write(`\n[release:${item.id}] ${item.executable} ${item.args.join(" ")}\n`);
      const result = execute(item);
      results.push({
        id: item.id,
        status: result.status === 0 ? "passed" : "failed",
        exitCode: result.status,
        signal: result.signal,
        durationMs: Date.now() - commandStartedAt,
        cwd: item.cwd,
        command: [item.executable, ...item.args],
        environment: Object.keys(item.env).sort(),
        outputDigest: result.outputDigest ?? null,
        evidence: result.evidence ?? null,
      });
      if (result.status !== 0) break;
    }
  }
  const final = attest();
  const contentUnchanged = initial.head === final.head && initial.contentDigest === final.contentDigest;
  const passed =
    !preflightError
    && initial.clean
    && final.clean
    && contentUnchanged
    && initial.head === plan.expectedHead
    && final.head === plan.expectedHead
    && results.length === plan.commands.length
    && results.every((result) => result.status === "passed");
  const completedAt = new Date();
  return {
    version: MANIFEST_VERSION,
    generatedAt: completedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    profile: plan.profile,
    expectedHead: plan.expectedHead,
    exactHead: initial.head,
    repositoryAttestation: { initial, final, contentUnchanged },
    preflightError,
    overallStatus: passed ? "passed" : "failed",
    readinessStatus: passed && plan.blockedExternal.length === 0 ? "READY" : passed ? "BLOCKED_EXTERNAL" : "FAILED",
    plannedCommandIds: plan.commands.map(({ id }) => id),
    results,
    blockedExternal: plan.blockedExternal,
    artifacts: collectArtifacts(),
    tools: collectTools(plan.commands),
    databaseIsolation: plan.databaseUrls
      ? {
        suiteCount: POSTGRES_SUITES.length,
        distinctDatabaseCount: new Set(Object.values(plan.databaseUrls)).size,
        databaseNames: Object.fromEntries(
          Object.entries(plan.databaseUrls).map(([key, value]) => [key, new URL(value).pathname.slice(1)]),
        ),
      }
      : null,
    safeguards: {
      productionDeploymentPerformed: false,
      providerActivationPerformed: false,
      canonicalWriterTransferPerformed: false,
      applicationSubmissionPerformed: false,
      externalStateInspected: false,
      childEnvironmentAllowlisted: true,
      outputContainedAndAtomic: true,
      dockerImageRemovedAfterProof: true,
    },
  };
}

export function resolveManifestOutput(path, root = process.cwd()) {
  if (!path || isAbsolute(path)) throw new Error("--output must be a relative path under .omx/verification");
  const allowedRoot = resolve(root, OUTPUT_ROOT);
  const output = resolve(root, path);
  if (output === allowedRoot || !output.startsWith(`${allowedRoot}${sep}`)) {
    throw new Error("--output must stay under .omx/verification");
  }
  if (existsSync(output)) throw new Error("--output must name a new file");
  mkdirSync(dirname(output), { recursive: true });
  const realAllowedRoot = realpathSync(allowedRoot);
  const realParent = realpathSync(dirname(output));
  if (realParent !== realAllowedRoot && !realParent.startsWith(`${realAllowedRoot}${sep}`)) {
    throw new Error("--output parent escapes .omx/verification through a symlink");
  }
  const ignored = git(["check-ignore", "-q", "--", relative(root, output)], { allowFailure: true });
  if (ignored.status !== 0) throw new Error("--output must be ignored by Git");
  return output;
}

export function writeManifestAtomic(path, manifest, root = process.cwd()) {
  const output = resolveManifestOutput(path, root);
  const temporary = resolve(dirname(output), `.${basename(output)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    linkSync(temporary, output);
    rmSync(temporary);
  } finally {
    rmSync(temporary, { force: true });
  }
  return output;
}

function parseArgs(argv) {
  const options = {
    profile: "repository",
    output: `${OUTPUT_ROOT}/job-supply-release-manifest.json`,
    includeFrontend: false,
    includeDocker: false,
    planOnly: false,
    expectedHead: process.env.G015_EXPECTED_HEAD ?? null,
    databaseUrl: process.env.G015_TEST_DATABASE_URL ?? null,
    allowDisposableDatabase: process.env.G015_ALLOW_DISPOSABLE_DATABASE === "true",
  };
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
    } else if (argument === "--expected-head") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--expected-head requires a SHA");
      options.expectedHead = value;
    } else if (argument === "--output") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--output requires a path");
      options.output = value;
    } else throw new Error(`unsupported argument: ${argument}`);
  }
  if (!options.planOnly && !options.expectedHead) {
    throw new Error("--expected-head is required for release verification");
  }
  return options;
}

const direct = import.meta.url === `file://${process.argv[1]}`;
if (direct) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--internal-attest-clean") {
    const attestation = repositoryAttestation();
    assertExpectedHead(process.env.G015_EXPECTED_HEAD, attestation.head);
    if (!attestation.clean) throw new Error("working tree is not clean");
  } else if (argv[0] === "--internal-stack-policy-revision") {
    console.log(JSON.stringify(verifyStackPolicyRevision()));
  } else if (argv[0] === "--internal-deployment-default-safety") {
    console.log(JSON.stringify(verifyDeploymentDefaults()));
  } else if (argv[0] === "--internal-database-freshness") {
    console.log(JSON.stringify(verifyFreshDatabase(
      process.env.G015_SUITE_DATABASE_URL,
      process.env.G015_ALLOW_DISPOSABLE_DATABASE === "true",
    )));
  } else if (argv[0] === "--internal-disabled-activation-proof") {
    console.log(JSON.stringify(verifyDisabledActivationState(
      process.env.G015_SUITE_DATABASE_URL,
      process.env.G015_ALLOW_DISPOSABLE_DATABASE === "true",
    )));
  } else if (argv[0] === "--internal-frontend-proof") {
    console.log(JSON.stringify(verifyFrontendBuild()));
  } else if (argv[0] === "--internal-docker-proof") {
    console.log(JSON.stringify(runDockerProof(process.env.G015_EXPECTED_HEAD)));
  } else {
    const options = parseArgs(argv);
    const plan = buildReleaseVerificationPlan(options);
    const manifest = options.planOnly
      ? {
        version: MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        profile: plan.profile,
        expectedHead: plan.expectedHead,
        readinessStatus: "BLOCKED_EXTERNAL",
        commands: plan.commands.map(({ env: _env, ...item }) => item),
        databaseIsolation: plan.databaseUrls
          ? {
            suiteCount: POSTGRES_SUITES.length,
            databaseNames: Object.fromEntries(
              Object.entries(plan.databaseUrls).map(([key, value]) => [key, new URL(value).pathname.slice(1)]),
            ),
          }
          : null,
        blockedExternal: plan.blockedExternal,
      }
      : runReleaseVerification(plan);
    const output = writeManifestAtomic(options.output, manifest);
    if (!options.planOnly) {
      const postOutput = repositoryAttestation();
      if (
        postOutput.head !== manifest.repositoryAttestation.final.head
        || postOutput.contentDigest !== manifest.repositoryAttestation.final.contentDigest
        || !postOutput.clean
      ) {
        rmSync(output, { force: true });
        throw new Error("manifest output changed the attested repository state");
      }
    }
    console.log(JSON.stringify({
      output: relative(process.cwd(), output),
      status: manifest.overallStatus ?? "planned",
      readinessStatus: manifest.readinessStatus,
    }));
    if (manifest.overallStatus === "failed") process.exitCode = 1;
  }
}
