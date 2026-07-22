import { createHash } from "node:crypto";
import { z } from "zod";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i)
  .transform((value) => value.toLowerCase());

const countrySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/));

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const productionShadowProviderSchema = z.enum(["greenhouse", "recruitee", "nicoka"]);

export type ProductionShadowProvider = z.output<typeof productionShadowProviderSchema>;

const completeSnapshotProviders = new Set<ProductionShadowProvider>(["greenhouse", "nicoka"]);

export function assertCompleteShadowSnapshotProven(provider: ProductionShadowProvider): void {
  if (!completeSnapshotProviders.has(provider)) {
    refuse(`${provider} public transport cannot prove complete snapshots`);
  }
}

export const atsInventoryShadowPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: productionShadowProviderSchema,
    mode: z.literal("shadow"),
    canonicalWritesEnabled: z.literal(false),
    policyId: z.string().trim().min(1).max(256),
    policyExpiresAt: z.iso.datetime({ offset: true }),
    tenantAllowlist: z.array(identifierSchema).min(1).max(500),
    countryAllowlist: z.array(countrySchema).min(1).max(250),
  })
  .strict()
  .superRefine((policy, context) => {
    for (const [path, values] of [
      ["tenantAllowlist", policy.tenantAllowlist],
      ["countryAllowlist", policy.countryAllowlist],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${path} contains duplicate normalized values`,
          path: [path],
        });
      }
    }
  });

export type AtsInventoryShadowPolicy = z.output<typeof atsInventoryShadowPolicySchema>;

export class AtsShadowRefusal extends Error {
  readonly code = "ATS_SHADOW_REFUSED" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`ATS_SHADOW_REFUSED: ${message}`, options);
    this.name = "AtsShadowRefusal";
  }
}

function refuse(message: string, cause?: unknown): never {
  throw new AtsShadowRefusal(message, cause === undefined ? undefined : { cause });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalPolicy(policy: AtsInventoryShadowPolicy) {
  return {
    ...policy,
    tenantAllowlist: [...policy.tenantAllowlist].sort(),
    countryAllowlist: [...policy.countryAllowlist].sort(),
  };
}

export function approveAtsInventoryShadowScope(input: {
  policy: unknown;
  provider: ProductionShadowProvider;
  approvedTenantId: string;
  countryCode: string;
  now?: Date;
}): {
  policy: AtsInventoryShadowPolicy;
  approvedTenantId: string;
  countryCode: string;
  policyDigest: string;
} {
  try {
    const policy = atsInventoryShadowPolicySchema.parse(input.policy);
    const provider = productionShadowProviderSchema.parse(input.provider);
    const approvedTenantId = identifierSchema.parse(input.approvedTenantId);
    const countryCode = countrySchema.parse(input.countryCode);
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) refuse("approval time is invalid");
    if (policy.provider !== provider) refuse("policy provider does not match");
    if (new Date(policy.policyExpiresAt).getTime() <= now.getTime()) {
      refuse("policy is expired");
    }
    if (!policy.tenantAllowlist.includes(approvedTenantId)) {
      refuse("tenant is not exactly allowlisted");
    }
    if (!policy.countryAllowlist.includes(countryCode)) {
      refuse("country is not exactly allowlisted");
    }
    return {
      policy,
      approvedTenantId,
      countryCode,
      policyDigest: sha256(canonicalJson(canonicalPolicy(policy))),
    };
  } catch (error) {
    if (error instanceof AtsShadowRefusal) throw error;
    refuse("ATS inventory shadow scope failed validation", error);
  }
}

const completeShadowJobSchema = z
  .object({
    externalId: z.string().trim().min(1).max(512),
    fingerprint: z.string().trim().min(1).max(512),
  })
  .strict();

export const atsCompleteShadowRunSchema = z
  .object({
    runId: z.string().trim().min(1).max(256),
    capturedAt: z.iso.datetime({ offset: true }),
    provider: productionShadowProviderSchema,
    tenantId: identifierSchema,
    countryCode: countrySchema,
    policyDigest: sha256Schema,
    complete: z.literal(true),
    requestCount: z.number().int().positive(),
    jobs: z.array(completeShadowJobSchema),
  })
  .strict()
  .superRefine((run, context) => {
    const externalIds = run.jobs.map((job) => job.externalId);
    if (new Set(externalIds).size !== externalIds.length) {
      context.addIssue({
        code: "custom",
        message: "complete shadow run contains duplicate external IDs",
        path: ["jobs"],
      });
    }
  });

export type AtsCompleteShadowRun = z.output<typeof atsCompleteShadowRunSchema>;

export function buildAtsRepeatedShadowScorecard(runs: readonly unknown[]) {
  try {
    if (runs.length < 2) refuse("at least two complete shadow runs are required");
    const parsed = runs.map((run) => atsCompleteShadowRunSchema.parse(run));
    const first = parsed[0]!;
    assertCompleteShadowSnapshotProven(first.provider);
    const scope = `${first.provider}\0${first.tenantId}\0${first.countryCode}\0${first.policyDigest}`;
    const runIds = new Set<string>();
    const timestamps = new Set<number>();
    for (const run of parsed) {
      if (`${run.provider}\0${run.tenantId}\0${run.countryCode}\0${run.policyDigest}` !== scope) {
        refuse("complete shadow runs have scope or policy drift");
      }
      if (runIds.has(run.runId)) refuse("complete shadow run IDs must be unique");
      runIds.add(run.runId);
      const timestamp = new Date(run.capturedAt).getTime();
      if (timestamps.has(timestamp)) {
        refuse("complete shadow run timestamps must be distinct");
      }
      timestamps.add(timestamp);
    }
    const ordered = [...parsed].sort(
      (left, right) =>
        new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime() ||
        left.runId.localeCompare(right.runId),
    );
    const reconciliation = ordered.slice(1).map((current, index) => {
      const previous = ordered[index]!;
      const before = new Map(previous.jobs.map((job) => [job.externalId, job.fingerprint]));
      const after = new Map(current.jobs.map((job) => [job.externalId, job.fingerprint]));
      return {
        fromRunId: previous.runId,
        toRunId: current.runId,
        additions: [...after.keys()].filter((id) => !before.has(id)).sort(),
        updates: [...after.keys()]
          .filter((id) => before.has(id) && before.get(id) !== after.get(id))
          .sort(),
        removals: [...before.keys()].filter((id) => !after.has(id)).sort(),
      };
    });
    const evidence = {
      schemaVersion: 1 as const,
      verdict: "complete_shadow_ready" as const,
      canonicalWritesEnabled: false as const,
      provider: first.provider,
      tenantId: first.tenantId,
      countryCode: first.countryCode,
      policyDigest: first.policyDigest,
      runIds: ordered.map((run) => run.runId),
      reconciliation,
    };
    return { ...evidence, evidenceDigest: sha256(canonicalJson(evidence)) };
  } catch (error) {
    if (error instanceof AtsShadowRefusal) throw error;
    refuse("repeated ATS shadow evidence failed validation", error);
  }
}

export function expiryDispositionAfterShadowFailure() {
  return {
    expireMissingJobs: false as const,
    reason: "incomplete_or_failed_shadow_run" as const,
  };
}
