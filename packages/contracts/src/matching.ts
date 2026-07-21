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
    targetRoleLabelsNormalized: uniqueArray(normalizedTokenSchema, 32),
    roleFamilyIds: uniqueArray(normalizedTokenSchema, 32),
    sectorIds: uniqueArray(normalizedTokenSchema, 32),
    industryIds: uniqueArray(normalizedTokenSchema, 32),
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
    targetRoleLabelsNormalized: uniqueArray(normalizedTokenSchema, 0),
    roleFamilyIds: uniqueArray(normalizedTokenSchema, 0),
    sectorIds: uniqueArray(normalizedTokenSchema, 0),
    industryIds: uniqueArray(normalizedTokenSchema, 0),
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
        value.targetRoleLabelsNormalized.length > 0 ||
        value.roleFamilyIds.length > 0 ||
        value.sectorIds.length > 0 ||
        value.industryIds.length > 0 ||
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

export const candidateSearchProfilePersistenceRowSchema = z
  .object({
    schema_version: z.literal(MATCHING_CONTRACT_VERSION),
    candidate_id: z.string().min(1).max(256),
    version: monotonicVersionSchema,
    status: candidateProjectionStatusSchema,
    target_role_label_normalized: normalizedTokenSchema.nullable(),
    target_role_labels_normalized: uniqueArray(normalizedTokenSchema, 32),
    role_family_ids: uniqueArray(normalizedTokenSchema, 32),
    sector_ids: uniqueArray(normalizedTokenSchema, 32),
    industry_ids: uniqueArray(normalizedTokenSchema, 32),
    rome_codes: uniqueArray(z.string().regex(/^[A-Z]\d{4}$/), 32),
    skill_ids: uniqueArray(normalizedTokenSchema, 128),
    skill_terms: uniqueArray(normalizedTokenSchema, 128),
    seniority_min: z.number().int().min(0).max(20).nullable(),
    seniority_max: z.number().int().min(0).max(20).nullable(),
    contract_types: uniqueArray(normalizedTokenSchema, 16),
    work_modes: uniqueArray(workModeSchema, 3),
    origin_latitude: z.number().min(-90).max(90).nullable(),
    origin_longitude: z.number().min(-180).max(180).nullable(),
    radius_km: z.number().positive().max(20_000).nullable(),
    country_codes: uniqueArray(countryCodeSchema, 250),
    location_policy: locationPolicySchema.nullable(),
    salary_floor: z.number().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    freshness_window_days: z.number().int().min(1).max(365).nullable(),
    exposure_policy_version: monotonicVersionSchema,
    feature_schema_version: z.string().min(1).max(64),
    source_profile_updated_at: z.iso.datetime({ offset: true }),
    projected_at: z.iso.datetime({ offset: true }),
    source_event_id: z.uuid(),
  })
  .strict();

export function toCandidateSearchProfilePersistenceRow(
  profile: z.input<typeof candidateSearchProfileSchema>,
  sourceEventId: string,
): CandidateSearchProfilePersistenceRow {
  const value = candidateSearchProfileSchema.parse(profile);
  return candidateSearchProfilePersistenceRowSchema.parse({
    schema_version: value.schemaVersion,
    candidate_id: value.candidateId,
    version: value.version,
    status: value.status,
    target_role_label_normalized: value.targetRoleLabelNormalized,
    target_role_labels_normalized: value.targetRoleLabelsNormalized,
    role_family_ids: value.roleFamilyIds,
    sector_ids: value.sectorIds,
    industry_ids: value.industryIds,
    rome_codes: value.romeCodes,
    skill_ids: value.skillIds,
    skill_terms: value.skillTerms,
    seniority_min: value.seniorityMin,
    seniority_max: value.seniorityMax,
    contract_types: value.contractTypes,
    work_modes: value.workModes,
    origin_latitude: value.originLatitude,
    origin_longitude: value.originLongitude,
    radius_km: value.radiusKm,
    country_codes: value.countryCodes,
    location_policy: value.locationPolicy,
    salary_floor: value.salaryFloor,
    currency: value.currency,
    freshness_window_days: value.freshnessWindowDays,
    exposure_policy_version: value.exposurePolicyVersion,
    feature_schema_version: value.featureSchemaVersion,
    source_profile_updated_at: value.sourceProfileUpdatedAt,
    projected_at: value.projectedAt,
    source_event_id: sourceEventId,
  });
}

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

export const candidateActionProjectionPersistenceRowSchema = z
  .object({
    schema_version: z.literal(MATCHING_CONTRACT_VERSION),
    candidate_id: z.string().min(1).max(256),
    action_id: z.string().min(1).max(256),
    candidate_version: monotonicVersionSchema,
    source_job_id: z.string().min(1).max(256),
    canonical_group_id: z.uuid(),
    canonical_group_aliases: uniqueArray(z.uuid(), 128),
    action_kind: candidateActionKindSchema,
    action_at: z.iso.datetime({ offset: true }),
    projected_at: z.iso.datetime({ offset: true }),
    retention_state: actionRetentionStateSchema,
    retained_until: z.iso.datetime({ offset: true }).nullable(),
    source_event_id: z.uuid(),
  })
  .strict();

export function toCandidateActionProjectionPersistenceRow(
  action: z.input<typeof candidateActionProjectionSchema>,
  sourceEventId: string,
): CandidateActionProjectionPersistenceRow {
  const value = candidateActionProjectionSchema.parse(action);
  return candidateActionProjectionPersistenceRowSchema.parse({
    schema_version: value.schemaVersion,
    candidate_id: value.candidateId,
    action_id: value.sourceActionId,
    candidate_version: value.version,
    source_job_id: value.sourceJobId,
    canonical_group_id: value.canonicalGroupId,
    canonical_group_aliases: value.canonicalGroupAliases,
    action_kind: value.kind,
    action_at: value.occurredAt,
    projected_at: value.projectedAt,
    retention_state: value.retentionState,
    retained_until: null,
    source_event_id: sourceEventId,
  });
}

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
    sectorIds: uniqueArray(normalizedTokenSchema, 32),
    industryIds: uniqueArray(normalizedTokenSchema, 32),
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

const jobSearchDocumentDerivedFieldsSchema = z
  .object({
    normalizedTitle: normalizedTokenSchema,
    searchText: z.string().trim().min(1).max(8_192),
  })
  .strict();

export const jobSearchDocumentPersistenceRowSchema = z
  .object({
    schema_version: z.literal(MATCHING_CONTRACT_VERSION),
    canonical_group_id: z.uuid(),
    preferred_job_id: z.string().min(1).max(256),
    job_version: monotonicVersionSchema,
    lifecycle_status: jobLifecycleStatusSchema,
    normalized_title: normalizedTokenSchema,
    role_family_codes: uniqueArray(normalizedTokenSchema, 32),
    sector_ids: uniqueArray(normalizedTokenSchema, 32),
    industry_ids: uniqueArray(normalizedTokenSchema, 32),
    rome_codes: uniqueArray(z.string().regex(/^[A-Z]\d{4}$/), 32),
    skill_codes: uniqueArray(normalizedTokenSchema, 256),
    seniority_min: z.number().int().min(0).max(20).nullable(),
    seniority_max: z.number().int().min(0).max(20).nullable(),
    contract_families: uniqueArray(normalizedTokenSchema, 16),
    work_modes: uniqueArray(workModeSchema, 3),
    country_codes: uniqueArray(countryCodeSchema, 1),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    location_confidence: z.number().min(0).max(1),
    location_unknown: z.boolean(),
    salary_min: z.null(),
    salary_max: z.null(),
    currency: z.null(),
    posted_at: z.iso.datetime({ offset: true }),
    last_seen_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    validation_status: jobValidationStatusSchema,
    applyability_tier: z.enum(["A", "B", "C", "D", "blocked"]),
    fulfillment_route: fulfillmentRouteSchema,
    source_eligible: z.boolean(),
    policy_eligible: z.boolean(),
    feature_schema_version: z.string().min(1).max(64),
    search_text: z.string().trim().min(1).max(8_192),
    source_updated_at: z.iso.datetime({ offset: true }),
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
    if (value.location_unknown && value.latitude !== null) {
      context.addIssue({
        code: "custom",
        path: ["location_unknown"],
        message: "unknown locations cannot contain coordinates",
      });
    }
  });

export function toJobSearchDocumentPersistenceRow(
  document: z.input<typeof jobSearchDocumentSchema>,
  derivedFields: z.input<typeof jobSearchDocumentDerivedFieldsSchema>,
): JobSearchDocumentPersistenceRow {
  const value = jobSearchDocumentSchema.parse(document);
  const derived = jobSearchDocumentDerivedFieldsSchema.parse(derivedFields);
  return jobSearchDocumentPersistenceRowSchema.parse({
    schema_version: value.schemaVersion,
    canonical_group_id: value.canonicalGroupId,
    preferred_job_id: value.preferredJobId,
    job_version: value.jobVersion,
    lifecycle_status: value.lifecycleStatus,
    normalized_title: derived.normalizedTitle,
    role_family_codes: value.roleFamilyIds,
    sector_ids: value.sectorIds,
    industry_ids: value.industryIds,
    rome_codes: value.romeCodes,
    skill_codes: value.skillIds,
    seniority_min: value.seniorityMin,
    seniority_max: value.seniorityMax,
    contract_families: value.contractTypes,
    work_modes: value.workModes,
    country_codes: value.countryCode === null ? [] : [value.countryCode],
    latitude: value.latitude,
    longitude: value.longitude,
    location_confidence: value.locationConfidence,
    location_unknown: value.locationUnknown,
    salary_min: null,
    salary_max: null,
    currency: null,
    posted_at: value.publishedAt,
    last_seen_at: value.lastSeenAt,
    expires_at: value.expiresAt,
    validation_status: value.validationStatus,
    applyability_tier: value.applyabilityTier,
    fulfillment_route: value.fulfillmentRoute,
    source_eligible: value.sourceEligible,
    policy_eligible: value.policyEligible,
    feature_schema_version: value.featureSchemaVersion,
    search_text: derived.searchText,
    source_updated_at: value.projectedAt,
  });
}

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

export const projectionTaskPersistenceRowSchema = z
  .object({
    schema_version: z.literal(MATCHING_CONTRACT_VERSION),
    task_id: z.uuid(),
    task_kind: projectionTaskKindSchema,
    entity_id: z.string().min(1).max(256),
    entity_version: monotonicVersionSchema,
    idempotency_key: z.string().min(1).max(512),
    status: z.literal("queued"),
    available_at: z.iso.datetime({ offset: true }),
    lease_owner: z.null(),
    lease_token: z.null(),
    lease_until: z.null(),
    attempts: z.number().int().min(0).max(100),
    max_attempts: z.number().int().min(1).max(100),
    last_error_code: z.null(),
  })
  .strict();

export function toProjectionTaskPersistenceRow(
  task: z.input<typeof projectionTaskSchema>,
): ProjectionTaskPersistenceRow {
  const value = projectionTaskSchema.parse(task);
  return projectionTaskPersistenceRowSchema.parse({
    schema_version: value.schemaVersion,
    task_id: value.taskId,
    task_kind: value.taskKind,
    entity_id: value.entityId,
    entity_version: value.entityVersion,
    idempotency_key: value.idempotencyKey,
    status: "queued",
    available_at: value.availableAt,
    lease_owner: null,
    lease_token: null,
    lease_until: null,
    attempts: value.attempt,
    max_attempts: 8,
    last_error_code: null,
  });
}

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
export type CandidateSearchProfilePersistenceRow = z.infer<
  typeof candidateSearchProfilePersistenceRowSchema
>;
export type CandidateActionProjection = z.infer<
  typeof candidateActionProjectionSchema
>;
export type CandidateActionProjectionPersistenceRow = z.infer<
  typeof candidateActionProjectionPersistenceRowSchema
>;
export type JobSearchDocument = z.infer<typeof jobSearchDocumentSchema>;
export type JobSearchDocumentPersistenceRow = z.infer<
  typeof jobSearchDocumentPersistenceRowSchema
>;
export type OnlineMatchRequest = z.infer<typeof onlineMatchRequestSchema>;
export type OnlineMatchResponse = z.infer<typeof onlineMatchResponseSchema>;
export type CandidateProjectionOutboxEvent = z.infer<
  typeof candidateProjectionOutboxEventSchema
>;
export type ProjectionTask = z.infer<typeof projectionTaskSchema>;
export type ProjectionTaskPersistenceRow = z.infer<
  typeof projectionTaskPersistenceRowSchema
>;
