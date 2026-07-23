import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  assertCompleteShadowSnapshotProven,
  buildAtsRepeatedShadowScorecard,
  productionShadowProviderSchema,
  type ProductionShadowProvider,
} from "./providers/ats-inventory-readiness";
import { createApprovedGreenhouseShadowTransport } from "./providers/greenhouse";
import { createApprovedNicokaShadowTransport } from "./providers/nicoka";
import { createApprovedRecruiteeShadowTransport } from "./providers/recruitee";
import type { AtsTrialFetch } from "./providers/ats-trial-transport";

const usage =
  "usage: ats-inventory-shadow <run|seal> --provider <greenhouse|recruitee|nicoka> --tenant <exact-tenant> --country FR --policy <path> --output <path> --evidence-root <path> --live | seal --run <path> --run <path> --output <path> --evidence-root <path>";

export type AtsInventoryShadowCliCommand =
  | {
      type: "run";
      provider: ProductionShadowProvider;
      tenantId: string;
      countryCode: "FR";
      policyPath: string;
      outputPath: string;
      evidenceRootPath: string;
    }
  | {
      type: "seal";
      runPaths: readonly [string, string];
      outputPath: string;
      evidenceRootPath: string;
    };

export function parseAtsInventoryShadowArgs(args: string[]): AtsInventoryShadowCliCommand {
  const [type, ...rest] = args;
  if (type !== "run" && type !== "seal") throw new Error(usage);
  const values = new Map<string, string[]>();
  for (let index = 0; index < rest.length; ) {
    const name = rest[index];
    const allowed =
      type === "run"
        ? [
            "--provider",
            "--tenant",
            "--country",
            "--policy",
            "--output",
            "--evidence-root",
            "--live",
          ]
        : ["--run", "--output", "--evidence-root"];
    if (!name || !allowed.includes(name)) {
      throw new Error(`${usage}; invalid argument: ${name ?? "missing"}`);
    }
    if (name === "--live") {
      if (type !== "run" || values.has(name))
        throw new Error(`duplicate or invalid argument: ${name}`);
      values.set(name, ["true"]);
      index += 1;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${usage}; invalid argument: ${name}`);
    const entries = values.get(name) ?? [];
    if (name !== "--run" && entries.length > 0) throw new Error(`duplicate argument: ${name}`);
    entries.push(value);
    values.set(name, entries);
    index += 2;
  }
  const one = (name: string) => values.get(name)?.[0];
  if (type === "run") {
    const provider = productionShadowProviderSchema.safeParse(one("--provider"));
    const tenantId = one("--tenant");
    if (
      !provider.success ||
      !tenantId ||
      /[?*[\]{}]/.test(tenantId) ||
      one("--country") !== "FR" ||
      !one("--policy") ||
      !one("--output") ||
      !one("--evidence-root") ||
      one("--live") !== "true" ||
      values.size !== 7
    ) {
      throw new Error(
        `${usage}; run requires exact provider, tenant, country FR, policy, output, evidence root, and --live true`,
      );
    }
    return {
      type,
      provider: provider.data,
      tenantId,
      countryCode: "FR",
      policyPath: one("--policy"),
      outputPath: one("--output"),
      evidenceRootPath: one("--evidence-root"),
    };
  }
  const runs = values.get("--run") ?? [];
  if (runs.length !== 2 || !one("--output") || !one("--evidence-root") || values.size !== 3) {
    throw new Error(`${usage}; seal requires exactly two --run paths, output, and evidence root`);
  }
  return {
    type,
    runPaths: [runs[0], runs[1]],
    outputPath: one("--output"),
    evidenceRootPath: one("--evidence-root"),
  };
}

const runArtifactSchema = z
  .object({
    schemaVersion: z.literal("job-supply-shadow-run.v1"),
    runId: z.string().min(1),
    provider: productionShadowProviderSchema,
    tenantId: z.string().min(1),
    countryCode: z.literal("FR"),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    complete: z.literal(true),
    canonicalWritesEnabled: z.literal(false),
    capturedAt: z.iso.datetime({ offset: true }),
    jobs: z.array(
      z
        .object({ externalId: z.string().min(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict(),
    ),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

type RunArtifact = z.output<typeof runArtifactSchema>;

export async function runAtsInventoryShadowCli(
  command: AtsInventoryShadowCliCommand,
  options: {
    fetch?: AtsTrialFetch;
    now?: () => Date;
    makeRunId?: () => string;
    evidenceHmacKey?: string;
  } = {},
): Promise<
  | RunArtifact
  | (ReturnType<typeof buildAtsRepeatedShadowScorecard> & {
      runs: readonly { path: string; sha256: string }[];
    })
> {
  const root = await resolveEvidenceRoot(command.evidenceRootPath);
  const evidenceHmacKey = requireEvidenceHmacKey(options.evidenceHmacKey);
  if (command.type === "seal") return seal(command, root, evidenceHmacKey);
  assertCompleteShadowSnapshotProven(command.provider);
  const policy = JSON.parse(await readRegularFile(command.policyPath));
  const approvalNow = options.now?.();
  const transport =
    command.provider === "greenhouse"
      ? createApprovedGreenhouseShadowTransport({
          approvedTenantId: command.tenantId,
          countryCode: command.countryCode,
          policy,
          now: approvalNow,
          fetch: options.fetch,
        })
      : command.provider === "recruitee"
        ? createApprovedRecruiteeShadowTransport({
            approvedTenantId: command.tenantId,
            countryCode: command.countryCode,
            policy,
            now: approvalNow,
            fetch: options.fetch,
          })
        : createApprovedNicokaShadowTransport({
            approvedTenantId: command.tenantId,
            countryCode: command.countryCode,
            policy,
            now: approvalNow,
            fetch: options.fetch,
            environment: "production",
          });
  const records = await transport.fetch(new AbortController().signal);
  const jobs = records
    .map((record) => ({
      externalId: `${transport.approvedTenantId}:${String((record as { id: string }).id)}`,
      fingerprint: sha256(canonicalJson(record)),
    }))
    .sort((left, right) => left.externalId.localeCompare(right.externalId));
  if (new Set(jobs.map((job) => job.externalId)).size !== jobs.length)
    throw new Error("shadow transport returned duplicate external IDs");
  const unsignedArtifact = {
    schemaVersion: "job-supply-shadow-run.v1" as const,
    runId: options.makeRunId?.() ?? randomUUID(),
    provider: command.provider,
    tenantId: transport.approvedTenantId,
    countryCode: "FR" as const,
    policyDigest: transport.policyDigest,
    complete: true as const,
    canonicalWritesEnabled: false as const,
    capturedAt: (options.now?.() ?? new Date()).toISOString(),
    jobs,
  };
  const artifact = runArtifactSchema.parse({
    ...unsignedArtifact,
    signature: signRunArtifact(unsignedArtifact, evidenceHmacKey),
  });
  await writeImmutableContained(command.outputPath, root, artifact);
  return artifact;
}

async function seal(
  command: Extract<AtsInventoryShadowCliCommand, { type: "seal" }>,
  root: string,
  evidenceHmacKey: string,
) {
  const loaded = await Promise.all(
    command.runPaths.map(async (path) => {
      const contents = await readContainedFile(path, root);
      const artifact = runArtifactSchema.parse(JSON.parse(contents));
      verifyRunArtifactSignature(artifact, evidenceHmacKey);
      return { path: await containedPath(path, root), contents, artifact };
    }),
  );
  const scorecard = buildAtsRepeatedShadowScorecard(
    loaded.map(({ artifact }) => ({
      runId: artifact.runId,
      capturedAt: artifact.capturedAt,
      provider: artifact.provider,
      tenantId: artifact.tenantId,
      countryCode: artifact.countryCode,
      policyDigest: artifact.policyDigest,
      complete: artifact.complete,
      requestCount: 1,
      jobs: artifact.jobs,
    })),
  );
  const byRunId = new Map(loaded.map((entry) => [entry.artifact.runId, entry]));
  const runs = scorecard.runIds.map((runId) => {
    const entry = byRunId.get(runId);
    if (!entry) throw new Error("scorecard run ID did not resolve to an input artifact");
    // Release evidence descriptors are intentionally root-relative; absolute
    // paths would be rejected by the verifier and leak local filesystem layout.
    return { path: relative(root, entry.path), sha256: sha256(entry.contents) };
  });
  const artifact = { ...scorecard, runs };
  await writeImmutableContained(command.outputPath, root, artifact);
  return artifact;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function requireEvidenceHmacKey(value = process.env.ATS_SHADOW_EVIDENCE_HMAC_KEY): string {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("ATS_SHADOW_EVIDENCE_HMAC_KEY must contain at least 32 characters");
  }
  return value;
}
function signRunArtifact(artifact: Omit<RunArtifact, "signature">, key: string): string {
  return createHmac("sha256", key).update(canonicalJson(artifact)).digest("hex");
}
function verifyRunArtifactSignature(artifact: RunArtifact, key: string): void {
  const { signature, ...unsignedArtifact } = artifact;
  const expected = signRunArtifact(unsignedArtifact, key);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    throw new Error("shadow run signature is invalid");
  }
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

async function resolveEvidenceRoot(path: string): Promise<string> {
  const root = resolve(path);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("evidence root must be a real directory, not a symlink");
  return realpath(root);
}
async function containedPath(path: string, root: string): Promise<string> {
  const candidate = await canonicalizePath(path);
  const rel = relative(root, candidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== candidate)
    throw new Error("artifact path must be contained by the evidence root");
  return candidate;
}
async function canonicalizePath(path: string): Promise<string> {
  let existing = resolve(path);
  const missingSegments: string[] = [];
  for (;;) {
    try {
      await lstat(existing);
      return resolve(await realpath(existing), ...missingSegments);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missingSegments.unshift(basename(existing));
      existing = parent;
    }
  }
}
async function readContainedFile(path: string, root: string): Promise<string> {
  const candidate = await containedPath(path, root);
  const segments = relative(root, candidate).split(sep);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error("artifact path must not traverse a symlink");
  }
  return readFile(candidate, "utf8");
}
async function readRegularFile(path: string): Promise<string> {
  const candidate = resolve(path);
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("policy path must be a regular file, not a symlink");
  return readFile(candidate, "utf8");
}
async function writeImmutableContained(path: string, root: string, value: unknown): Promise<void> {
  const candidate = await containedPath(path, root);
  const parent = dirname(candidate);
  await ensureRealDirectory(parent, root);
  const file = await open(candidate, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await file.close();
  }
}
async function ensureRealDirectory(path: string, root: string): Promise<void> {
  const relativePath = relative(root, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`))
    throw new Error("artifact path must be contained by the evidence root");
  await mkdir(path, { recursive: true });
  let current = root;
  for (const segment of relativePath ? relativePath.split(sep) : []) {
    current = resolve(current, segment);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("artifact path must not traverse a symlink");
  }
}

if (import.meta.main) {
  const command = parseAtsInventoryShadowArgs(process.argv.slice(2));
  const result = await runAtsInventoryShadowCli(command);
  console.log(
    JSON.stringify({
      runId: "runId" in result ? result.runId : undefined,
      output: command.outputPath,
      canonicalWritesEnabled: false,
    }),
  );
}
