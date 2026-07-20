import { z } from "zod";

export const CONTRACT_VERSION = "worker-foundation.v1" as const;

export const providerSchema = z.enum(["apec", "hellowork", "wttj", "indeed"]);
export const triggerSourceSchema = z.enum(["schedule", "cli", "http", "system"]);
export const runKindSchema = z.enum(["provider_ingestion", "inventory_maintenance"]);
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
]);
export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "retryable",
  "succeeded",
  "failed",
  "cancelled",
]);
export const authorizationStatusSchema = z.enum([
  "unverified",
  "authorized",
  "blocked",
]);
export const writerRuntimeSchema = z.enum(["none", "python", "typescript"]);
export const sourceRunModeSchema = z.enum([
  "incremental",
  "full_snapshot",
  "census",
  "shadow",
  "dry_run",
  "backfill",
]);
export const sourceAccessTypeSchema = z.enum([
  "public_api",
  "open_data",
  "tenant_feed",
  "partner_feed",
]);
export const sourceLifecycleStateSchema = z.enum([
  "active",
  "stale",
  "removed",
  "expired",
  "blocked",
]);

export const rateLimitConfigSchema = z
  .object({
    requestsPerMinute: z.number().int().positive().max(60_000),
    concurrency: z.number().int().positive().max(100),
  })
  .strict();

export const providerSearchRequestSchema = z
  .object({
    provider: providerSchema,
    query: z.string().trim().min(1).max(256).nullable().default(null),
    location: z.string().trim().min(1).max(256).nullable().default(null),
    countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
    cursor: z.string().min(1).max(512).nullable().default(null),
    pageSize: z.number().int().positive().max(100).default(50),
    maxPages: z.number().int().positive().max(5).default(5),
  })
  .strict();

export const rawProviderJobEnvelopeSchema = z
  .object({
    provider: providerSchema,
    externalId: z.string().trim().min(1).max(512),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const sourceCheckpointSchema = z
  .object({
    version: z.string().trim().min(1).max(64).optional(),
    cursor: z.string().min(1).max(2_048).nullable().optional(),
    partition: z.string().trim().min(1).max(512).nullable().optional(),
    watermark: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .catchall(z.unknown());

const countryKillSwitchesSchema = z
  .record(z.string().regex(/^[A-Z]{2}$/), z.boolean())
  .default({});

export const sourceFetchRequestSchema = z
  .object({
    provider: providerSchema,
    sourceId: z.uuid(),
    sourceKey: z.string().trim().min(1).max(512),
    tenantKey: z.string().trim().min(1).max(512).nullable(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    mode: sourceRunModeSchema,
    checkpoint: sourceCheckpointSchema.nullable(),
    pageSize: z.number().int().positive().max(500),
  })
  .strict();

export const sourceRegistryEntrySchema = z
  .object({
    id: z.uuid(),
    provider: providerSchema,
    sourceKey: z.string().trim().min(1).max(512),
    tenantKey: z.string().trim().min(1).max(512).nullable(),
    countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
    accessType: sourceAccessTypeSchema,
    policyId: z.uuid().nullable(),
    enabled: z.boolean(),
    transportEnabled: z.boolean(),
    incrementalEnabled: z.boolean(),
    backfillEnabled: z.boolean(),
    checkpoint: sourceCheckpointSchema.nullable(),
  })
  .strict();

export const sourcePolicyStateSchema = z
  .object({
    approvalStatus: z.enum(["unverified", "approved", "blocked", "expired"]),
    enabled: z.boolean(),
    commercialUseAllowed: z.boolean(),
    redisplayAllowed: z.boolean(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const sourceRuntimePolicySchema = z
  .object({
    providerEnabled: z.boolean(),
    writerRuntime: writerRuntimeSchema,
    providerCountryKillSwitches: countryKillSwitchesSchema,
    sourceCountryKillSwitches: countryKillSwitchesSchema,
    source: sourceRegistryEntrySchema,
    policy: sourcePolicyStateSchema,
  })
  .strict();

export const providerRegistrySchema = z
  .object({
    provider: providerSchema,
    accessMethod: z.string().min(1).max(128),
    authorizationStatus: authorizationStatusSchema,
    authorizationEvidenceRef: z.string().min(1).max(512).nullable(),
    authorizationReviewedAt: z.iso.datetime({ offset: true }).nullable(),
    enabled: z.boolean(),
    writerRuntime: writerRuntimeSchema,
    rateLimitConfig: rateLimitConfigSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.enabled &&
      (value.authorizationStatus !== "authorized" ||
        value.writerRuntime !== "typescript")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "enabled providers require authorized status and TypeScript writer ownership",
        path: ["enabled"],
      });
    }
    if (
      value.enabled &&
      (!value.authorizationEvidenceRef || !value.authorizationReviewedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "enabled providers require reviewed authorization evidence",
        path: ["authorizationEvidenceRef"],
      });
    }
  });

export const taskTypeSchema = z.enum(["provider.fetch_page", "inventory.maintenance"]);

export const enqueueRunSchema = z
  .object({
    kind: runKindSchema,
    provider: providerSchema.nullable(),
    idempotencyKey: z.string().min(1).max(256),
    triggerSource: triggerSourceSchema,
    scheduleId: z.string().min(1).max(128).nullable().default(null),
    scheduledFor: z.iso.datetime({ offset: true }).nullable().default(null),
    tasks: z
      .array(
        z
          .object({
            taskKey: z.string().min(1).max(256),
            taskType: taskTypeSchema,
            payload: z.record(z.string(), z.unknown()),
            availableAt: z.iso.datetime({ offset: true }).optional(),
            maxAttempts: z.number().int().positive().max(100).default(5),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const scheduled = value.triggerSource === "schedule";
    if (scheduled !== Boolean(value.scheduleId && value.scheduledFor)) {
      context.addIssue({
        code: "custom",
        message:
          "schedule triggers require scheduleId and scheduledFor; other triggers must omit them",
        path: ["triggerSource"],
      });
    }
    if (
      (value.kind === "provider_ingestion") !== Boolean(value.provider)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "provider ingestion requires a provider; inventory maintenance must be provider-neutral",
        path: ["provider"],
      });
    }
    const expectedTaskType =
      value.kind === "provider_ingestion"
        ? "provider.fetch_page"
        : "inventory.maintenance";
    value.tasks.forEach((task, index) => {
      if (task.taskType !== expectedTaskType) {
        context.addIssue({
          code: "custom",
          message: `run kind requires ${expectedTaskType} tasks`,
          path: ["tasks", index, "taskType"],
        });
      }
    });
  });

export const runViewSchema = z
  .object({
    id: z.uuid(),
    kind: runKindSchema,
    provider: providerSchema.nullable(),
    triggerSource: triggerSourceSchema,
    status: runStatusSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
    summary: z.record(z.string(), z.unknown()),
    errorCode: z.string().nullable(),
  })
  .strict();

export const healthSchema = z
  .object({
    status: z.enum(["live", "ready", "not_ready"]),
    contractVersion: z.literal(CONTRACT_VERSION),
  })
  .strict();

export const canonicalJobSchema = z
  .object({
    jobId: z.string().regex(/^job_[0-9a-f]{16}$/),
    provider: providerSchema,
    externalId: z.string().min(1),
    title: z.string().min(1),
    normalizedTitle: z.string().min(1),
    company: z.string().min(1),
    normalizedCompany: z.string().min(1),
    location: z.string().min(1),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    selectedApplyUrl: z.url().nullable(),
    validationStatus: z.enum(["valid", "invalid", "unknown"]),
    validationReason: z.string().min(1),
    validationCheckedAt: z.iso.datetime({ offset: true }),
    applyabilityTier: z.enum(["A", "B", "C", "D", "E"]),
    applyabilityScore: z.number().min(0).max(1),
    applyFulfillmentStatus: z.enum([
      "manual_ready",
      "needs_validation",
      "validation_unknown",
      "blocked_missing_apply_url",
      "blocked_expired",
      "blocked_captcha",
      "blocked_user_account_required",
      "discovery_only",
    ]),
    applyUrlProvider: z.string().min(1),
    atsProvider: z.string().min(1),
    requiresLogin: z.boolean(),
    requiresAccountCreation: z.boolean(),
    captchaDetected: z.boolean(),
    manualFulfillmentReady: z.boolean(),
    autoApplySupported: z.boolean(),
    rejectionReason: z.string().min(1).nullable(),
    fingerprint: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export const validationResultSchema = canonicalJobSchema.pick({
  selectedApplyUrl: true,
  validationStatus: true,
  validationReason: true,
  validationCheckedAt: true,
  applyabilityTier: true,
  applyabilityScore: true,
  applyFulfillmentStatus: true,
  applyUrlProvider: true,
  atsProvider: true,
  requiresLogin: true,
  requiresAccountCreation: true,
  captchaDetected: true,
  manualFulfillmentReady: true,
  autoApplySupported: true,
  rejectionReason: true,
});

export const stableErrorCodeSchema = z.enum([
  "authorization_blocked",
  "invalid_input",
  "lease_lost",
  "provider_transient",
  "provider_permanent",
  "retry_exhausted",
  "integrity_error",
  "database_unavailable",
]);

export type Provider = z.infer<typeof providerSchema>;
export type SourceRunMode = z.infer<typeof sourceRunModeSchema>;
export type SourceAccessType = z.infer<typeof sourceAccessTypeSchema>;
export type SourceLifecycleState = z.infer<typeof sourceLifecycleStateSchema>;
export type SourceCheckpoint = z.infer<typeof sourceCheckpointSchema>;
export type SourceFetchRequest = z.infer<typeof sourceFetchRequestSchema>;
export type SourceRegistryEntry = z.infer<typeof sourceRegistryEntrySchema>;
export type SourcePolicyState = z.infer<typeof sourcePolicyStateSchema>;
export type SourceRuntimePolicy = z.infer<typeof sourceRuntimePolicySchema>;
export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;
export type AuthorizationStatus = z.infer<typeof authorizationStatusSchema>;
export type ProviderRegistry = z.infer<typeof providerRegistrySchema>;
export type ProviderSearchRequest = z.infer<typeof providerSearchRequestSchema>;
export type RawProviderJobEnvelope = z.infer<
  typeof rawProviderJobEnvelopeSchema
>;
export type EnqueueRun = z.infer<typeof enqueueRunSchema>;
export type RunView = z.infer<typeof runViewSchema>;
export type CanonicalJob = z.infer<typeof canonicalJobSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type StableErrorCode = z.infer<typeof stableErrorCodeSchema>;
