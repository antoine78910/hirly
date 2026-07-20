#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const MANIFEST_VERSION = "job-supply-release-verification.v2";
const MIGRATION_RE = /^20260720\d+_.+\.sql$/;
const PYTHON_EXCEPTION_RE = /^\s*#\s*stack-policy:\s*python-exception=(.{12,})\s*$/im;
const DISPOSABLE_DB_RE = /(?:^|_)(?:test|disposable)(?:$|_)/i;

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
  assertDisposableDatabase(databaseUrl, options.allowDisposableDatabase === true);
  const commands = [
    command("repository-attestation", "node", ["scripts/verify-job-supply-release.mjs", "--internal-attest-clean"]),
    command("frozen-install", "bun", ["install", "--frozen-lockfile"]),
    command("typecheck", "bun", ["run", "typecheck"]),
    command("lint", "bun", ["run", "lint"]),
    command("tests", "bun", ["run", "test"]),
    command("build", "bun", ["run", "build"]),
    command("release-contracts", "bun", ["test", "tests/g015-release-readiness.test.ts"]),
    command("stack-policy-revision", "node", ["scripts/verify-job-supply-release.mjs", "--internal-stack-policy-revision"]),
    command("deployment-default-safety", "node", ["scripts/verify-job-supply-release.mjs", "--internal-deployment-default-safety"]),
    command("diff-check", "git", ["diff", "--check"]),
  ];

  if (includeFrontend) {
    commands.push(
      command("legacy-frontend-frozen-install", "npm", ["ci", "--legacy-peer-deps"], { cwd: "frontend" }),
      command("legacy-frontend-build", "npm", ["run", "build"], { cwd: "frontend", env: { CI: "false" } }),
    );
  }
  if (includeDocker) {
    commands.push(command("worker-docker-build", "docker", ["build", "-f", "apps/worker/Dockerfile", "-t", "hirly-worker:release-verification", "."]));
  }
  if (databaseUrl) {
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
      env: Object.fromEntries([
        "G002_TEST_DATABASE_URL", "G003_TEST_DATABASE_URL", "G004_TEST_DATABASE_URL",
        "G010_TEST_DATABASE_URL", "G011_TEST_DATABASE_URL",
        "JOB_INGESTION_LEDGER_TEST_DATABASE_URL", "G014_TEST_DATABASE_URL",
      ].map((name) => [name, databaseUrl])),
      redactEnvironment: true,
    }));
  }
  return {
    profile: full ? "full" : "repository",
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

function command(id, executable, args, options = {}) {
  return { id, executable, args, cwd: options.cwd ?? ".", env: options.env ?? {}, redactEnvironment: options.redactEnvironment ?? false };
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

export function verifyDeploymentDefaults(root = process.cwd()) {
  const migrationDir = resolve(root, "backend/db/migrations");
  const ups = readdirSync(migrationDir).filter((name) => MIGRATION_RE.test(name) && !name.endsWith(".down.sql")).sort();
  const downs = new Set(readdirSync(migrationDir).filter((name) => name.endsWith(".down.sql")));
  const missingDown = ups.filter((name) => !downs.has(name.replace(/\.sql$/, ".down.sql")));
  if (missingDown.length) throw new Error(`migrations missing down files: ${missingDown.join(", ")}`);
  for (const name of ups) {
    const sql = readFileSync(resolve(migrationDir, name), "utf8");
    if (/INSERT\s+INTO\s+(?:public\.)?(?:source_schedules|career_sources)[\s\S]{0,500}\b(?:enabled|is_enabled)\s*\)[\s\S]{0,300}\btrue\b/i.test(sql)) {
      throw new Error(`${name} enables a source or schedule by default`);
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
  const options = { profile: "repository", output: ".omx/verification/job-supply-release-manifest.json", includeFrontend: false, includeDocker: false, planOnly: false, databaseUrl: process.env.G015_TEST_DATABASE_URL ?? null, allowDisposableDatabase: process.env.G015_ALLOW_DISPOSABLE_DATABASE === "true" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--with-frontend") options.includeFrontend = true;
    else if (argument === "--with-docker") options.includeDocker = true;
    else if (argument === "--allow-disposable-database") options.allowDisposableDatabase = true;
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

export function executeCommand(item, output = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) }) {
  const result = spawnSync(item.executable, item.args, { cwd: resolve(process.cwd(), item.cwd), env: { ...process.env, ...item.env }, encoding: item.redactEnvironment ? "utf8" : undefined, stdio: item.redactEnvironment ? "pipe" : "inherit", shell: false });
  if (item.redactEnvironment) {
    const secrets = Object.values(item.env);
    const stdout = redactSensitiveText(result.stdout, secrets);
    const stderr = redactSensitiveText(result.stderr, secrets);
    output.stdout(stdout);
    output.stderr(stderr);
    return { ...result, stdout, stderr };
  }
  return result;
}

function run(plan) {
  const startedAt = new Date();
  const initial = repositoryAttestation();
  const results = [];
  if (!initial.clean) {
    results.push({ id: "repository-attestation", status: "failed", exitCode: 1, durationMs: 0, error: "working tree is not clean; verification cannot attest exact HEAD content" });
  } else {
    for (const item of plan.commands) {
      const commandStartedAt = Date.now();
      process.stdout.write(`\n[release:${item.id}] ${item.executable} ${item.args.join(" ")}\n`);
      const result = executeCommand(item);
      results.push({ id: item.id, status: result.status === 0 ? "passed" : "failed", exitCode: result.status, signal: result.signal, durationMs: Date.now() - commandStartedAt, cwd: item.cwd, command: [item.executable, ...item.args], environment: item.redactEnvironment ? "[REDACTED]" : Object.keys(item.env).sort() });
      if (result.status !== 0) break;
    }
  }
  const final = repositoryAttestation();
  const contentUnchanged = initial.head === final.head && initial.contentDigest === final.contentDigest;
  const passed = initial.clean && final.clean && contentUnchanged && results.length === plan.commands.length && results.every((result) => result.status === "passed");
  return {
    version: MANIFEST_VERSION, generatedAt: new Date().toISOString(), startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), profile: plan.profile,
    exactHead: initial.head, repositoryAttestation: { initial, final, contentUnchanged },
    overallStatus: passed ? "passed" : "failed", readinessStatus: passed && plan.blockedExternal.length === 0 ? "READY" : passed ? "BLOCKED_EXTERNAL" : "FAILED",
    results, blockedExternal: plan.blockedExternal,
    safeguards: { productionDeploymentPerformed: false, providerActivationPerformed: false, canonicalWriterTransferPerformed: false, applicationSubmissionPerformed: false, externalStateInspected: false },
  };
}

function writeManifest(path, manifest) {
  const output = resolve(process.cwd(), path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
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
  } else {
    const options = parseArgs(argv);
    const plan = buildReleaseVerificationPlan(options);
    const manifest = options.planOnly ? { version: MANIFEST_VERSION, generatedAt: new Date().toISOString(), profile: plan.profile, readinessStatus: "BLOCKED_EXTERNAL", commands: plan.commands.map(({ env: _env, ...item }) => item), blockedExternal: plan.blockedExternal } : run(plan);
    writeManifest(options.output, manifest);
    console.log(JSON.stringify({ output: options.output, status: manifest.overallStatus ?? "planned", readinessStatus: manifest.readinessStatus }));
    if (manifest.overallStatus === "failed") process.exitCode = 1;
  }
}
