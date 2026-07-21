import { z } from "zod";

export const MATCHING_CONTRACT_VERSION = "hirly.matching.v1" as const;

export const monotonicVersionSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "version must be a positive decimal string");

const normalizedTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => value === value.toLowerCase(), {
    message: "value must be normalized to lowercase",
  });

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

function uniqueArray<T extends z.ZodType>(item: T, maximum: number) {
  return z
    .array(item)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: "values must be unique",
    });
}

export const candidateProjectionStatusSchema = z.enum([
  "active",
  "paused",
  "deleted",
]);
export const locationPolicySchema = z.enum([
  "explicit",
  "country",
  "worldwide",
]);
export const workModeSchema = z.enum(["onsite", "hybrid", "remote"]);
export const fulfillmentRouteSchema = z.enum([
  "auto",
  "assisted",
  "manual",
  "blocked",
]);

const activeCandidateSearchProfileSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    candidateId: z.string().min(1).max(256),
    version: monotonicVersionSchema,
    status: z.enum(["active", "paused"]),
    targetRoleLabelNormalized: normalizedTokenSchema.nullable(),
    roleFamilyIds: uniqueArray(normalizedTokenSchema, 32),
    romeCodes: uniqueArray(z.string().regex(/^[A-Z]\d{4}$/), 32),
    skillIds: uniqueArray(normalizedTokenSchema, 128),
    skillTerms: uniqueArray(normalizedTokenSchema, 128),
    seniorityMin: z.number().int().min(0).max(20).nullable(),
    seniorityMax: z.number().int().min(0).max(20).nullable(),
    contractTypes: uniqueArray(normalizedTokenSchema, 16),
    workModes: uniqueArray(workModeSchema, 3),
    originLatitude: z.number().min(-90).max(90).nullable(),
    originLongitude: z.number().min(-180).max(180).nullable(),
    radiusKm: z.number().positive().max(20_000).nullable(),
    countryCodes: uniqueArray(countryCodeSchema, 250),
    locationPolicy: locationPolicySchema,
    salaryFloor: z.number().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    freshnessWindowDays: z.number().int().min(1).max(365),
    exposurePolicyVersion: monotonicVersionSchema,
    featureSchemaVersion: z.string().min(1).max(64),
    sourceProfileUpdatedAt: z.iso.datetime({ offset: true }),
    projectedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.originLatitude === null) !== (value.originLongitude === null)) {
      context.addIssue({
        code: "custom",
        path: ["originLatitude"],
        message: "latitude and longitude must be provided together",
      });
    }
    if (
      value.seniorityMin !== null &&
      value.seniorityMax !== null &&
      value.seniorityMin > value.seniorityMax
    ) {
      context.addIssue({
        code: "custom",
        path: ["seniorityMax"],
        message: "seniorityMax must be greater than or equal to seniorityMin",
      });
    }
  });

const deletedCandidateSearchProfileSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    candidateId: z.string().min(1).max(256),
    version: monotonicVersionSchema,
    status: z.literal("deleted"),
    targetRoleLabelNormalized: z.null(),
    roleFamilyIds: uniqueArray(normalizedTokenSchema, 0),
    romeCodes: uniqueArray(z.string().regex(/^[A-Z]\d{4}$/), 0),
    skillIds: uniqueArray(normalizedTokenSchema, 0),
    skillTerms: uniqueArray(normalizedTokenSchema, 0),
    seniorityMin: z.null(),
    seniorityMax: z.null(),
    contractTypes: uniqueArray(normalizedTokenSchema, 0),
    workModes: uniqueArray(workModeSchema, 0),
    originLatitude: z.null(),
    originLongitude: z.null(),
    radiusKm: z.null(),
    countryCodes: uniqueArray(countryCodeSchema, 0),
    locationPolicy: z.null(),
    salaryFloor: z.null(),
    currency: z.null(),
    freshnessWindowDays: z.null(),
    exposurePolicyVersion: monotonicVersionSchema,
    featureSchemaVersion: z.string().min(1).max(64),
    sourceProfileUpdatedAt: z.iso.datetime({ offset: true }),
    projectedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const candidateSearchProfileSchema = z
  .union([activeCandidateSearchProfileSchema, deletedCandidateSearchProfileSchema])
  .superRefine((value, context) => {
    if (
      value.status === "deleted" &&
      (value.targetRoleLabelNormalized !== null ||
        value.roleFamilyIds.length > 0 ||
        value.romeCodes.length > 0 ||
        value.skillIds.length > 0 ||
        value.skillTerms.length > 0 ||
        value.seniorityMin !== null ||
        value.seniorityMax !== null ||
        value.contractTypes.length > 0 ||
        value.workModes.length > 0 ||
        value.originLatitude !== null ||
        value.originLongitude !== null ||
        value.radiusKm !== null ||
        value.countryCodes.length > 0 ||
        value.locationPolicy !== null ||
        value.salaryFloor !== null ||
        value.currency !== null ||
        value.freshnessWindowDays !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "deleted projections must fail closed and minimize matching attributes",
      });
    }
  });

export const candidateActionKindSchema = z.enum([
  "seen",
  "dismissed",
  "applied",
  "undo",
]);
export const actionRetentionStateSchema = z.enum([
  "active",
  "superseded",
  "deleted",
]);

export const candidateActionProjectionSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    candidateId: z.string().min(1).max(256),
    sourceActionId: z.string().min(1).max(256),
    sourceJobId: z.string().min(1).max(256),
    canonicalGroupId: z.uuid(),
    canonicalGroupAliases: uniqueArray(z.uuid(), 128),
    kind: candidateActionKindSchema,
    version: monotonicVersionSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    retentionState: actionRetentionStateSchema,
    projectedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const jobLifecycleStatusSchema = z.enum([
  "active",
  "stale",
  "removed",
  "expired",
  "blocked",
]);
export const jobValidationStatusSchema = z.enum([
  "valid",
  "review",
  "invalid",
]);

export const jobSearchDocumentSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    canonicalGroupId: z.uuid(),
    preferredJobId: z.string().min(1).max(256),
    jobVersion: monotonicVersionSchema,
    roleFamilyIds: uniqueArray(normalizedTokenSchema, 32),
    romeCodes: uniqueArray(z.string().regex(/^[A-Z]\d{4}$/), 32),
    skillIds: uniqueArray(normalizedTokenSchema, 256),
    seniorityMin: z.number().int().min(0).max(20).nullable(),
    seniorityMax: z.number().int().min(0).max(20).nullable(),
    contractTypes: uniqueArray(normalizedTokenSchema, 16),
    workModes: uniqueArray(workModeSchema, 3),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    countryCode: countryCodeSchema.nullable(),
    locationConfidence: z.number().min(0).max(1),
    locationUnknown: z.boolean(),
    publishedAt: z.iso.datetime({ offset: true }),
    lastSeenAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    lifecycleStatus: jobLifecycleStatusSchema,
    validationStatus: jobValidationStatusSchema,
    applyabilityTier: z.enum(["A", "B", "C", "D", "blocked"]),
    fulfillmentRoute: fulfillmentRouteSchema,
    sourceEligible: z.boolean(),
    policyEligible: z.boolean(),
    featureSchemaVersion: z.string().min(1).max(64),
    projectedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.latitude === null) !== (value.longitude === null)) {
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "latitude and longitude must be provided together",
      });
    }
    if (value.locationUnknown && value.latitude !== null) {
      context.addIssue({
        code: "custom",
        path: ["locationUnknown"],
        message: "unknown locations cannot contain coordinates",
      });
    }
  });

export const matchExplanationCodeSchema = z.enum([
  "role_match",
  "skill_match",
  "location_match",
  "remote_match",
  "contract_match",
  "fresh_inventory",
  "quality_inventory",
  "auto_route",
  "assisted_route",
  "manual_route",
]);

export const matchingEmptyReasonSchema = z.enum([
  "PROFILE_INACTIVE",
  "DELETION_PENDING",
  "PROJECTION_LAG",
  "NO_FRESH_INVENTORY",
  "NO_ELIGIBLE_INVENTORY",
  "NO_MATCHING_INVENTORY",
  "ALL_ACTIONED",
  "ALL_POLICY_HIDDEN",
]);

export const onlineMatchRequestSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    candidateId: z.string().min(1).max(256),
    profileVersion: monotonicVersionSchema,
    actionWatermark: monotonicVersionSchema,
    matcherVersion: z.string().min(1).max(64),
    requestedAt: z.iso.datetime({ offset: true }),
    coarseLimit: z.number().int().min(1).max(1_000),
    resultLimit: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((value) => value.resultLimit <= value.coarseLimit, {
    path: ["resultLimit"],
    message: "resultLimit cannot exceed coarseLimit",
  });

export const onlineMatchResultItemSchema = z
  .object({
    canonicalGroupId: z.uuid(),
    preferredJobId: z.string().min(1).max(256),
    jobVersion: monotonicVersionSchema,
    relevanceScore: z.number().min(0).max(1),
    fulfillmentRoute: fulfillmentRouteSchema,
    explanationCodes: uniqueArray(matchExplanationCodeSchema, 10),
  })
  .strict();

export const onlineMatchResponseSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    candidateId: z.string().min(1).max(256),
    profileVersion: monotonicVersionSchema,
    actionWatermark: monotonicVersionSchema,
    matcherVersion: z.string().min(1).max(64),
    coarseCandidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    hiddenCount: z.number().int().nonnegative(),
    emptyReason: matchingEmptyReasonSchema.nullable(),
    results: z.array(onlineMatchResultItemSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.results.map((result) => result.canonicalGroupId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "canonical groups must be unique",
      });
    }
    if ((value.results.length === 0) !== (value.emptyReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["emptyReason"],
        message: "emptyReason must be present only for empty results",
      });
    }
  });

export const candidateProjectionOutboxEventSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    eventId: z.uuid(),
    candidateId: z.string().min(1).max(256),
    eventFamily: z.enum([
      "profiles",
      "swipes",
      "applications",
      "users",
      "deletion",
    ]),
    entityId: z.string().min(1).max(256),
    operation: z.enum(["insert", "update", "delete"]),
    entityVersion: monotonicVersionSchema,
    idempotencyKey: z.string().min(1).max(512),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const projectionTaskKindSchema = z.enum([
  "candidate.profile.project",
  "candidate.action.project",
  "candidate.delete",
  "job.document.project",
  "projection.reconcile",
]);

export const projectionTaskSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    taskId: z.uuid(),
    taskKind: projectionTaskKindSchema,
    entityId: z.string().min(1).max(256),
    entityVersion: monotonicVersionSchema,
    idempotencyKey: z.string().min(1).max(512),
    availableAt: z.iso.datetime({ offset: true }),
    attempt: z.number().int().min(0).max(100),
  })
  .strict();

export const matchingRollbackControlsSchema = z
  .object({
    schemaVersion: z.literal(MATCHING_CONTRACT_VERSION),
    profileProducerEnabled: z.boolean(),
    actionProducerEnabled: z.boolean(),
    consentProducerEnabled: z.boolean(),
    relayEnabled: z.boolean(),
    servingEnabled: z.boolean(),
  })
  .strict();

export type CandidateSearchProfile = z.infer<
  typeof candidateSearchProfileSchema
>;
export type CandidateActionProjection = z.infer<
  typeof candidateActionProjectionSchema
>;
export type JobSearchDocument = z.infer<typeof jobSearchDocumentSchema>;
export type OnlineMatchRequest = z.infer<typeof onlineMatchRequestSchema>;
export type OnlineMatchResponse = z.infer<typeof onlineMatchResponseSchema>;
export type CandidateProjectionOutboxEvent = z.infer<
  typeof candidateProjectionOutboxEventSchema
>;
export type ProjectionTask = z.infer<typeof projectionTaskSchema>;
