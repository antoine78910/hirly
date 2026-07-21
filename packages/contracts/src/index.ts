import { z } from "zod";

export * from "./analytics";
export * from "./matching";

export const CONTRACT_VERSION = "worker-foundation.v1" as const;

export const providerSchema = z.enum([
  "apec",
  "hellowork",
  "wttj",
  "indeed",
  "france_travail",
  "data_gouv",
  "greenhouse",
  "lever",
  "recruitee",
  "nicoka",
  "sprout",
]);
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
export const sourceTrialEnvironmentSchema = z.enum([
  "development",
  "test",
  "staging",
]);
export const sourceTrialStatusSchema = z.enum([
  "completed",
  "budget_exhausted",
  "policy_expired",
  "failed",
]);
export const sourceTrialBudgetStopReasonSchema = z.enum([
  "budget_exceeded",
  "budget_exceeded:maxPages",
  "budget_exceeded:maxCandidates",
  "budget_exceeded:maxBytes",
]);
export const sourceTrialFailureStopReasonSchema = z.enum([
  "cancelled",
  "malformed",
  "not_found",
  "permanent",
  "policy_not_started",
  "rate_limited",
  "retryable",
  "unclassified_failure",
]);

export const sourceTrialBudgetSchema = z
  .object({
    maxPages: z.number().int().positive().max(10_000),
    maxCandidates: z.number().int().positive().max(1_000_000),
    maxBytes: z.number().int().positive().max(1_073_741_824),
  })
  .strict();

export const sourceTrialTenantSelectionEvidenceSchema = z
  .object({
    reference: z.string().trim().min(1).max(2_048),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const sourceTrialManifestSchema = z
  .object({
    schemaVersion: z.literal("hirly.source-trial-manifest.v1"),
    trialKey: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[a-z0-9]+(?:[a-z0-9._:-]*[a-z0-9])?$/),
    sourceId: z.uuid(),
    provider: providerSchema,
    tenantKey: z.string().trim().min(1).max(512),
    environment: sourceTrialEnvironmentSchema,
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(250),
    policyEvidenceId: z.uuid(),
    tenantSelectionEvidence: sourceTrialTenantSelectionEvidenceSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    budget: sourceTrialBudgetSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(value.expiresAt) <= new Date(value.requestedAt)) {
      context.addIssue({
        code: "custom",
        message: "trial expiry must be after its request time",
        path: ["expiresAt"],
      });
    }
    if (new Set(value.countryCodes).size !== value.countryCodes.length) {
      context.addIssue({
        code: "custom",
        message: "trial country codes must be unique",
        path: ["countryCodes"],
      });
    }
  });

const sourceTrialResultBaseSchema = z
  .object({
    schemaVersion: z.literal("hirly.source-trial-result.v1"),
    runId: z.uuid(),
    trialKey: z.string().trim().min(1).max(256),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
    pagesFetched: z.number().int().nonnegative(),
    candidatesObserved: z.number().int().nonnegative(),
    bytesStored: z.number().int().nonnegative(),
  })
  .strict();

export const sourceTrialResultSchema = z
  .discriminatedUnion("status", [
    sourceTrialResultBaseSchema.extend({
      status: z.literal("completed"),
      stopReason: z.null(),
    }),
    sourceTrialResultBaseSchema.extend({
      status: z.literal("budget_exhausted"),
      stopReason: sourceTrialBudgetStopReasonSchema,
    }),
    sourceTrialResultBaseSchema.extend({
      status: z.literal("policy_expired"),
      stopReason: z.literal("policy_expired"),
    }),
    sourceTrialResultBaseSchema.extend({
      status: z.literal("failed"),
      stopReason: sourceTrialFailureStopReasonSchema,
    }),
  ])
  .superRefine((value, context) => {
    if (new Date(value.finishedAt) < new Date(value.startedAt)) {
      context.addIssue({
        code: "custom",
        message: "trial result cannot finish before it started",
        path: ["finishedAt"],
      });
    }
  });

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
    pageSize: z.number().int().positive().max(150).default(50),
    maxPages: z.number().int().positive().max(20).default(5),
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
    countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(250),
    accessType: sourceAccessTypeSchema,
    policyId: z.uuid().nullable(),
    enabled: z.boolean(),
    transportEnabled: z.boolean(),
    incrementalEnabled: z.boolean(),
    backfillEnabled: z.boolean(),
    checkpoint: sourceCheckpointSchema.nullable(),
  })
  .strict();

export const registryProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

const httpsBaseUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    context.addIssue({
      code: "custom",
      message:
        "base URL must use HTTPS without credentials, query parameters, or fragments",
    });
  }
});

export const careerSourceCandidateRegistrationSchema = z
  .object({
    provider: registryProviderSchema,
    sourceKey: z.string().trim().min(1).max(512),
    tenantKey: z.string().trim().min(1).max(512),
    companyId: z.string().trim().min(1).max(512).nullable(),
    companyName: z.string().trim().min(1).max(512).nullable(),
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(250),
    baseUrl: httpsBaseUrlSchema,
    accessType: sourceAccessTypeSchema,
    syncFrequencySeconds: z.number().int().positive().nullable(),
    checkpoint: sourceCheckpointSchema,
  })
  .strict();

export const careerSourceCandidateSchema = careerSourceCandidateRegistrationSchema
  .extend({
    id: z.uuid(),
    policyId: z.uuid().nullable(),
    lastAttemptAt: z.iso.datetime({ offset: true }).nullable(),
    lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
    lastCompleteRunId: z.uuid().nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    enabled: z.boolean(),
    transportEnabled: z.boolean(),
    incrementalEnabled: z.boolean(),
    backfillEnabled: z.boolean(),
    discoveryState: z.enum([
      "candidate",
      "detected",
      "validated",
      "rejected",
      "approved",
    ]),
  })
  .strict();

export const sourcePolicyStateSchema = z
  .object({
    approvalStatus: z.enum(["unverified", "approved", "blocked", "expired"]),
    enabled: z.boolean(),
    commercialUseAllowed: z.boolean(),
    redisplayAllowed: z.boolean(),
    fullTextRetentionAllowed: z.boolean(),
    enabledEnvironments: z
      .array(z.enum(["development", "test", "staging", "production"]))
      .min(1),
    permittedAccessMethods: z.array(sourceAccessTypeSchema).min(1),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const sourceRuntimePolicySchema = z
  .object({
    providerEnabled: z.boolean(),
    providerAuthorizationStatus: authorizationStatusSchema,
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
    city: z.string().min(1).nullable().optional(),
    region: z.string().min(1).nullable().optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    remote: z.boolean().nullable().optional(),
    salaryMin: z.number().nonnegative().nullable().optional(),
    salaryMax: z.number().nonnegative().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    postedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    importedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    lastSeenAt: z.iso.datetime({ offset: true }).nullable().optional(),
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
  .strict()
  .superRefine((value, context) => {
    if (
      value.salaryMin != null &&
      value.salaryMax != null &&
      value.salaryMin > value.salaryMax
    ) {
      context.addIssue({
        code: "custom",
        message: "salary minimum cannot exceed salary maximum",
        path: ["salaryMin"],
      });
    }
  });

export const sourcePageCommitEntrySchema = z
  .object({
    canonical: canonicalJobSchema,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    fetchedAt: z.iso.datetime({ offset: true }),
    sourceDocument: z.record(z.string(), z.unknown()),
    canonicalSourceUrl: z.url().nullable(),
    canonicalApplyUrl: z.url().nullable(),
    atsPostingId: z.string().trim().min(1).max(512).nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    lifecycleState: sourceLifecycleStateSchema,
    attribution: z.record(z.string(), z.unknown()),
    policyId: z.uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.canonical.provider !== "sprout") {
      context.addIssue({
        code: "custom",
        message: "source page commit entries are Sprout-scoped",
        path: ["canonical", "provider"],
      });
    }
  });

export const sourcePageCommitSchema = z
  .object({
    sourceId: z.uuid(),
    countryCode: z.literal("FR"),
    mode: z.enum(["canary", "incremental", "backfill"]),
    checkpointIn: sourceCheckpointSchema,
    checkpointOut: sourceCheckpointSchema,
    complete: z.boolean(),
    entries: z.array(sourcePageCommitEntrySchema).max(500),
  })
  .strict();

export const sourcePageCommitResultSchema = z
  .object({
    snapshotsInserted: z.number().int().nonnegative(),
    canonicalUpserts: z.number().int().nonnegative(),
    occurrencesUpserted: z.number().int().nonnegative(),
    groupsCreated: z.number().int().nonnegative(),
    checkpoint: sourceCheckpointSchema,
  })
  .strict();

export const sproutCanaryEvidenceSchema = z
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
  .strict();

export const sproutRollbackEvidenceSchema = z
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
  .strict();

export const sproutSourceRuntimeSchema = z
  .object({
    sourceId: z.uuid(),
    sourceKey: z.string().trim().min(1).max(512),
    policyId: z.uuid(),
    endpoint: httpsBaseUrlSchema,
    credentialRef: z
      .string()
      .regex(/^secret:\/\/[a-z0-9][a-z0-9/_-]{2,127}$/),
    approvedPageSize: z.number().int().positive().max(500),
    checkpoint: sourceCheckpointSchema,
    policyEvidenceRef: z.string().trim().min(1).max(2_048),
    canaryEvidence: sproutCanaryEvidenceSchema,
    rollbackEvidence: sproutRollbackEvidenceSchema,
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
export type SourceTrialEnvironment = z.infer<
  typeof sourceTrialEnvironmentSchema
>;
export type SourceTrialStatus = z.infer<typeof sourceTrialStatusSchema>;
export type SourceTrialBudget = z.infer<typeof sourceTrialBudgetSchema>;
export type SourceTrialManifest = z.infer<typeof sourceTrialManifestSchema>;
export type SourceTrialResult = z.infer<typeof sourceTrialResultSchema>;
export type SourceCheckpoint = z.infer<typeof sourceCheckpointSchema>;
export type SourceFetchRequest = z.infer<typeof sourceFetchRequestSchema>;
export type SourceRegistryEntry = z.infer<typeof sourceRegistryEntrySchema>;
export type CareerSourceCandidateRegistration = z.infer<
  typeof careerSourceCandidateRegistrationSchema
>;
export type CareerSourceCandidate = z.infer<
  typeof careerSourceCandidateSchema
>;
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
export type SourcePageCommit = z.infer<typeof sourcePageCommitSchema>;
export type SourcePageCommitResult = z.infer<
  typeof sourcePageCommitResultSchema
>;
export type SproutSourceRuntime = z.infer<typeof sproutSourceRuntimeSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type StableErrorCode = z.infer<typeof stableErrorCodeSchema>;
