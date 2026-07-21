import { z } from "zod";

export const sproutFranceRegistrationSchema = z
  .object({
    provider: z.literal("sprout"),
    sourceKey: z.literal("sprout-france"),
    countryCodes: z.tuple([z.literal("FR")]),
    accessType: z.literal("partner_feed"),
    authorizationStatus: z.enum(["unverified", "blocked", "authorized"]),
    writerRuntime: z.enum(["none", "python", "typescript"]),
    policyStatus: z.enum(["pending", "blocked", "expired", "approved"]),
    requestsPerMinute: z.number().int().positive().max(60),
    concurrency: z.literal(1),
    enabled: z.boolean(),
    transportEnabled: z.boolean(),
    canaryEnabled: z.boolean(),
    incrementalEnabled: z.boolean(),
    backfillEnabled: z.boolean(),
    providerCountryKillSwitch: z.boolean(),
    sourceCountryKillSwitch: z.boolean(),
    approvedPageSize: z.number().int().positive().max(500).nullable(),
  })
  .strict();

export type SproutFranceRegistration = z.infer<
  typeof sproutFranceRegistrationSchema
>;

export const SPROUT_FRANCE_DISABLED_REGISTRATION =
  sproutFranceRegistrationSchema.parse({
    provider: "sprout",
    sourceKey: "sprout-france",
    countryCodes: ["FR"],
    accessType: "partner_feed",
    authorizationStatus: "unverified",
    writerRuntime: "none",
    policyStatus: "pending",
    requestsPerMinute: 6,
    concurrency: 1,
    enabled: false,
    transportEnabled: false,
    canaryEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    providerCountryKillSwitch: true,
    sourceCountryKillSwitch: true,
    approvedPageSize: null,
  });

export const sproutActivationSchema = sproutFranceRegistrationSchema.extend({
  policyEvidenceRef: z.string().trim().min(1).max(512).nullable(),
  redisplayAllowed: z.boolean(),
  fullTextRetentionAllowed: z.boolean(),
  credentialRef: z
    .string()
    .regex(/^secret:\/\/[a-z0-9][a-z0-9/_-]{2,127}$/),
  canaryEvidence: z
    .object({
      status: z.enum(["pending", "failed", "passed"]),
      evidenceRef: z.string().trim().min(1).max(512).nullable(),
      pagesCommitted: z.union([z.literal(0), z.literal(1)]),
      identityReadBack: z.boolean(),
      rawSnapshotLinked: z.boolean(),
      occurrenceLinked: z.boolean(),
      checkpointReadBack: z.boolean(),
      singleWriterVerified: z.boolean(),
    })
    .strict(),
  rollbackEvidence: z
    .object({
      status: z.enum(["pending", "failed", "passed"]),
      evidenceRef: z.string().trim().min(1).max(512).nullable(),
      providerKillSwitchVerified: z.boolean(),
      sourceKillSwitchVerified: z.boolean(),
      scheduleDisableVerified: z.boolean(),
      transportDisableVerified: z.boolean(),
      outstandingTasksStopVerified: z.boolean(),
      writerClaimReleaseVerified: z.boolean(),
    })
    .strict(),
});

export const sproutTaskPayloadSchema = z
  .object({
    sourceId: z.uuid(),
    mode: z.enum(["canary", "backfill", "incremental"]),
    maxResponseBytes: z.number().int().positive().max(50_000_000),
    filterVariant: z.enum(["qualified_radius", "country_only"]).default("qualified_radius"),
    emptyInsertStreak: z.number().int().min(0).max(2).default(0),
  })
  .strict();

export type SproutActivation = z.infer<typeof sproutActivationSchema>;

export function assertSproutActivationReady(
  input: SproutActivation,
  mode: "canary" | "backfill" | "incremental",
): SproutActivation {
  const activation = sproutActivationSchema.parse(input);
  const modeEnabled =
    mode === "canary"
      ? activation.canaryEnabled
      : mode === "backfill"
      ? activation.backfillEnabled
      : activation.incrementalEnabled;
  if (
    activation.authorizationStatus !== "authorized" ||
    activation.writerRuntime !== "typescript" ||
    activation.policyStatus !== "approved" ||
    activation.policyEvidenceRef === null ||
    !activation.redisplayAllowed ||
    !activation.fullTextRetentionAllowed ||
    activation.approvedPageSize === null ||
    !activation.enabled ||
    !activation.transportEnabled ||
    !modeEnabled ||
    activation.providerCountryKillSwitch ||
    activation.sourceCountryKillSwitch
  ) {
    throw new Error("sprout_activation_blocked");
  }
  if (mode !== "canary" && !releaseEvidencePassed(activation)) {
    throw new Error("sprout_release_evidence_incomplete");
  }
  if (
    mode === "canary" &&
    (activation.canaryEvidence.status !== "pending" ||
      activation.canaryEvidence.pagesCommitted !== 0)
  ) {
    throw new Error("sprout_canary_already_committed");
  }
  return activation;
}

function releaseEvidencePassed(activation: SproutActivation): boolean {
  const canary = activation.canaryEvidence;
  const rollback = activation.rollbackEvidence;
  return (
    canary.status === "passed" &&
    canary.evidenceRef !== null &&
    canary.pagesCommitted === 1 &&
    canary.identityReadBack &&
    canary.rawSnapshotLinked &&
    canary.occurrenceLinked &&
    canary.checkpointReadBack &&
    canary.singleWriterVerified &&
    rollback.status === "passed" &&
    rollback.evidenceRef !== null &&
    rollback.providerKillSwitchVerified &&
    rollback.sourceKillSwitchVerified &&
    rollback.scheduleDisableVerified &&
    rollback.transportDisableVerified &&
    rollback.outstandingTasksStopVerified &&
    rollback.writerClaimReleaseVerified
  );
}
