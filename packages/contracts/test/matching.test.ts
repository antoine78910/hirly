import { describe, expect, test } from "bun:test";
import * as matchingContracts from "../src";
import {
  MATCHING_CONTRACT_VERSION,
  candidateActionProjectionPersistenceRowSchema,
  candidateActionProjectionSchema,
  candidateProjectionOutboxEventSchema,
  candidateSearchProfilePersistenceRowSchema,
  candidateSearchProfileSchema,
  jobSearchDocumentSchema,
  toJobSearchDocumentPersistenceRow,
  matchingRollbackControlsSchema,
  monotonicVersionSchema,
  onlineMatchRequestSchema,
  onlineMatchResponseSchema,
  projectionTaskKindSchema,
  projectionTaskPersistenceRowSchema,
  projectionTaskSchema,
  toCandidateActionProjectionPersistenceRow,
  toCandidateSearchProfilePersistenceRow,
  toProjectionTaskPersistenceRow,
} from "../src";

const now = "2026-07-21T04:00:00+00:00";
const groupId = "11111111-1111-4111-8111-111111111111";

function expectExactKeys(value: object, keys: readonly string[]): void {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

const candidateProfile = {
  schemaVersion: MATCHING_CONTRACT_VERSION,
  candidateId: "mongo-user-id",
  version: "9007199254740993",
  status: "active" as const,
  targetRoleLabelNormalized: "fullstack engineer",
  roleFamilyIds: ["software-engineering"],
  romeCodes: ["M1805"],
  skillIds: ["typescript"],
  skillTerms: ["typescript"],
  seniorityMin: 2,
  seniorityMax: 5,
  contractTypes: ["permanent"],
  workModes: ["hybrid" as const],
  originLatitude: 48.8566,
  originLongitude: 2.3522,
  radiusKm: 52,
  countryCodes: ["FR"],
  locationPolicy: "explicit" as const,
  salaryFloor: 50_000,
  currency: "EUR",
  freshnessWindowDays: 30,
  exposurePolicyVersion: "1",
  featureSchemaVersion: "matching-features.v1",
  sourceProfileUpdatedAt: now,
  projectedAt: now,
};

describe("matching v1 contracts", () => {
  test("preserves bigint versions as decimal strings", () => {
    expect(monotonicVersionSchema.parse("9007199254740993")).toBe(
      "9007199254740993",
    );
    for (const invalid of [0, 1, 9_007_199_254_740_992, "0", "01", "-1"]) {
      expect(() => monotonicVersionSchema.parse(invalid)).toThrow();
    }
    expect(candidateSearchProfileSchema.parse(candidateProfile).version).toBe(
      "9007199254740993",
    );
  });

  test("keeps candidate profiles purpose-limited and strictly normalized", () => {
    for (const forbidden of [
      { rawCv: "private cv" },
      { email: "candidate@example.com" },
      { phone: "+33123456789" },
      { coverLetter: "private letter" },
      { arbitraryText: "unbounded source text" },
    ]) {
      expect(() =>
        candidateSearchProfileSchema.parse({ ...candidateProfile, ...forbidden }),
      ).toThrow();
    }
    expect(() =>
      candidateSearchProfileSchema.parse({
        ...candidateProfile,
        skillIds: ["TypeScript"],
      }),
    ).toThrow();
    expect(() =>
      candidateSearchProfileSchema.parse({
        ...candidateProfile,
        skillIds: ["typescript", "typescript"],
      }),
    ).toThrow();
    expect(() =>
      candidateSearchProfileSchema.parse({
        ...candidateProfile,
        originLongitude: null,
      }),
    ).toThrow();
    expect(() =>
      candidateSearchProfileSchema.parse({
        ...candidateProfile,
        seniorityMin: 6,
        seniorityMax: 5,
      }),
    ).toThrow();
    expect(() =>
      jobSearchDocumentSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        canonicalGroupId: groupId,
        preferredJobId: "job-text-id",
        jobVersion: "2",
        roleFamilyIds: ["software-engineering"],
        romeCodes: ["M1805"],
        skillIds: ["typescript"],
        seniorityMin: 2,
        seniorityMax: 5,
        contractTypes: ["permanent"],
        workModes: ["hybrid" as const],
        latitude: 48.8566,
        longitude: null,
        countryCode: "FR",
        locationConfidence: 0.99,
        locationUnknown: false,
        publishedAt: now,
        lastSeenAt: now,
        expiresAt: null,
        lifecycleStatus: "active" as const,
        validationStatus: "valid" as const,
        applyabilityTier: "B" as const,
        fulfillmentRoute: "manual" as const,
        sourceEligible: true,
        policyEligible: true,
        featureSchemaVersion: "matching-features.v1",
        projectedAt: now,
      }),
    ).toThrow();
    expect(() =>
      jobSearchDocumentSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        canonicalGroupId: groupId,
        preferredJobId: "job-text-id",
        jobVersion: "2",
        roleFamilyIds: ["software-engineering"],
        romeCodes: ["M1805"],
        skillIds: ["typescript"],
        seniorityMin: 2,
        seniorityMax: 5,
        contractTypes: ["permanent"],
        workModes: ["hybrid" as const],
        latitude: 48.8566,
        longitude: 2.3522,
        countryCode: "FR",
        locationConfidence: 0.99,
        locationUnknown: true,
        publishedAt: now,
        lastSeenAt: now,
        expiresAt: null,
        lifecycleStatus: "active" as const,
        validationStatus: "valid" as const,
        applyabilityTier: "B" as const,
        fulfillmentRoute: "manual" as const,
        sourceEligible: true,
        policyEligible: true,
        featureSchemaVersion: "matching-features.v1",
        projectedAt: now,
      }),
    ).toThrow();
  });

  test("deleted projections fail closed for all matching attributes", () => {
    expect(() =>
      candidateSearchProfileSchema.parse({
        ...candidateProfile,
        status: "deleted",
      }),
    ).toThrow();
    const deletedProfile = {
      ...candidateProfile,
      status: "deleted" as const,
      targetRoleLabelNormalized: null,
      roleFamilyIds: [],
      romeCodes: [],
      skillIds: [],
      skillTerms: [],
      seniorityMin: null,
      seniorityMax: null,
      contractTypes: [],
      workModes: [],
      originLatitude: null,
      originLongitude: null,
      radiusKm: null,
      countryCodes: [],
      locationPolicy: null,
      salaryFloor: null,
      currency: null,
      freshnessWindowDays: null,
    };
    expect(candidateSearchProfileSchema.parse(deletedProfile).status).toBe(
      "deleted",
    );
    const row = toCandidateSearchProfilePersistenceRow(
      deletedProfile,
      "44444444-4444-4444-8444-444444444444",
    );
    expect(row).toMatchObject({
      status: "deleted",
      location_policy: null,
      freshness_window_days: null,
      projected_at: now,
    });
    expectExactKeys(row, [
      "schema_version",
      "candidate_id",
      "version",
      "status",
      "target_role_label_normalized",
      "role_family_ids",
      "rome_codes",
      "skill_ids",
      "skill_terms",
      "seniority_min",
      "seniority_max",
      "contract_types",
      "work_modes",
      "origin_latitude",
      "origin_longitude",
      "radius_km",
      "country_codes",
      "location_policy",
      "salary_floor",
      "currency",
      "freshness_window_days",
      "exposure_policy_version",
      "feature_schema_version",
      "source_profile_updated_at",
      "projected_at",
      "source_event_id",
    ]);
    expect(() =>
      candidateSearchProfilePersistenceRowSchema.parse({
        ...row,
        raw_cv: "forbidden",
      }),
    ).toThrow();
  });

  test("validates purpose-limited action and opaque outbox envelopes", () => {
    const action = candidateActionProjectionSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        candidateId: "mongo-user-id",
        sourceActionId: "swipe-123",
        sourceJobId: "job-text-id",
        canonicalGroupId: groupId,
        canonicalGroupAliases: [],
        kind: "dismissed",
        version: "9007199254740994",
        occurredAt: now,
        retentionState: "active",
        projectedAt: now,
      });
    expect(action.sourceJobId).toBe("job-text-id");
    const actionRow = toCandidateActionProjectionPersistenceRow(
      action,
      "55555555-5555-4555-8555-555555555555",
    );
    expect(actionRow).toMatchObject({
      action_id: "swipe-123",
      candidate_version: "9007199254740994",
      action_kind: "dismissed",
      action_at: now,
      projected_at: now,
      retention_state: "active",
    });
    expectExactKeys(actionRow, [
      "schema_version",
      "candidate_id",
      "action_id",
      "candidate_version",
      "source_job_id",
      "canonical_group_id",
      "canonical_group_aliases",
      "action_kind",
      "action_at",
      "projected_at",
      "retention_state",
      "retained_until",
      "source_event_id",
    ]);
    expect(() =>
      candidateActionProjectionPersistenceRowSchema.parse({
        ...actionRow,
        kind: "liked",
      }),
    ).toThrow();

    const event = {
      schemaVersion: MATCHING_CONTRACT_VERSION,
      eventId: "22222222-2222-4222-8222-222222222222",
      candidateId: "mongo-user-id",
      eventFamily: "profiles" as const,
      entityId: "mongo-user-id",
      operation: "insert" as const,
      entityVersion: "9007199254740995",
      idempotencyKey: "profile:mongo-user-id:9007199254740995",
      occurredAt: now,
    };
    expect(candidateProjectionOutboxEventSchema.parse(event)).toEqual(event);
    expect(() =>
      candidateProjectionOutboxEventSchema.parse({
        ...event,
        payload: { email: "candidate@example.com" },
      }),
    ).toThrow();
    expect(
      onlineMatchResponseSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        candidateId: "mongo-user-id",
        profileVersion: "3",
        actionWatermark: "5",
        matcherVersion: "deterministic.v1",
        coarseCandidateCount: 0,
        eligibleCount: 0,
        hiddenCount: 1,
        emptyReason: "NO_FRESH_INVENTORY" as const,
        results: [],
      }).emptyReason,
    ).toBe("NO_FRESH_INVENTORY");
  });

  test("aligns job documents on array-valued contracts and work modes", () => {
    const document = {
      schemaVersion: MATCHING_CONTRACT_VERSION,
      canonicalGroupId: groupId,
      preferredJobId: "job-text-id",
      jobVersion: "2",
      roleFamilyIds: ["software-engineering"],
      romeCodes: ["M1805"],
      skillIds: ["typescript"],
      seniorityMin: 2,
      seniorityMax: 5,
      contractTypes: ["permanent"],
      workModes: ["hybrid" as const, "remote" as const],
      latitude: 48.8566,
      longitude: 2.3522,
      countryCode: "FR",
      locationConfidence: 0.99,
      locationUnknown: false,
      publishedAt: now,
      lastSeenAt: now,
      expiresAt: null,
      lifecycleStatus: "active" as const,
      validationStatus: "valid" as const,
      applyabilityTier: "B" as const,
      fulfillmentRoute: "manual" as const,
      sourceEligible: true,
      policyEligible: true,
      featureSchemaVersion: "matching-features.v1",
      projectedAt: now,
    };
    expect(jobSearchDocumentSchema.parse(document).contractTypes).toEqual([
      "permanent",
    ]);
    expect(() =>
      jobSearchDocumentSchema.parse({
        ...document,
        workModes: "hybrid",
      }),
    ).toThrow();

    expect(
      toJobSearchDocumentPersistenceRow(document, {
        normalizedTitle: "fullstack engineer",
        searchText: "fullstack engineer typescript",
      }),
    ).toMatchObject({
      schema_version: MATCHING_CONTRACT_VERSION,
      canonical_group_id: groupId,
      job_version: "2",
      role_family_codes: ["software-engineering"],
      skill_codes: ["typescript"],
      seniority_min: 2,
      seniority_max: 5,
      contract_families: ["permanent"],
      country_codes: ["FR"],
      location_confidence: 0.99,
      location_unknown: false,
      posted_at: now,
      last_seen_at: now,
      expires_at: null,
      validation_status: "valid",
      applyability_tier: "B",
      feature_schema_version: "matching-features.v1",
      search_text: "fullstack engineer typescript",
      projected_at: now,
    });
    expectExactKeys(
      toJobSearchDocumentPersistenceRow(document, {
        normalizedTitle: "fullstack engineer",
        searchText: "fullstack engineer typescript",
      }),
      [
        "schema_version",
        "canonical_group_id",
        "preferred_job_id",
        "job_version",
        "lifecycle_status",
        "normalized_title",
        "role_family_codes",
        "rome_codes",
        "skill_codes",
        "seniority_min",
        "seniority_max",
        "contract_families",
        "work_modes",
        "country_codes",
        "latitude",
        "longitude",
        "location_confidence",
        "location_unknown",
        "salary_min",
        "salary_max",
        "currency",
        "posted_at",
        "last_seen_at",
        "expires_at",
        "validation_status",
        "applyability_tier",
        "fulfillment_route",
        "source_eligible",
        "policy_eligible",
        "feature_schema_version",
        "search_text",
        "projected_at",
      ],
    );
  });

  test("enforces bounded deterministic online matcher contracts", () => {
    expect(
      onlineMatchRequestSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        candidateId: "mongo-user-id",
        profileVersion: "3",
        actionWatermark: "5",
        matcherVersion: "deterministic.v1",
        requestedAt: now,
        coarseLimit: 1_000,
        resultLimit: 100,
      }).resultLimit,
    ).toBe(100);
    expect(() =>
      onlineMatchRequestSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        candidateId: "mongo-user-id",
        profileVersion: "3",
        actionWatermark: "5",
        matcherVersion: "deterministic.v1",
        requestedAt: now,
        coarseLimit: 10,
        resultLimit: 11,
      }),
    ).toThrow();

    const response = {
      schemaVersion: MATCHING_CONTRACT_VERSION,
      candidateId: "mongo-user-id",
      profileVersion: "3",
      actionWatermark: "5",
      matcherVersion: "deterministic.v1",
      coarseCandidateCount: 2,
      eligibleCount: 2,
      hiddenCount: 0,
      emptyReason: null,
      results: [
        {
          canonicalGroupId: groupId,
          preferredJobId: "job-text-id",
          jobVersion: "2",
          relevanceScore: 0.91,
          fulfillmentRoute: "manual" as const,
          explanationCodes: ["role_match" as const, "manual_route" as const],
        },
      ],
    };
    expect(onlineMatchResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      onlineMatchResponseSchema.parse({
        ...response,
        results: [response.results[0], response.results[0]],
      }),
    ).toThrow();
    expect(() =>
      onlineMatchResponseSchema.parse({
        ...response,
        results: [],
        emptyReason: null,
      }),
    ).toThrow();
  });

  test("keeps common projection tasks and rollback flags explicit", () => {
    const commonKinds = [
      "candidate.profile.project",
      "candidate.action.project",
      "candidate.delete",
      "job.document.project",
      "projection.reconcile",
    ] as const;
    expect(projectionTaskKindSchema.options).toEqual([...commonKinds]);
    const task = {
        schemaVersion: MATCHING_CONTRACT_VERSION,
        taskId: "33333333-3333-4333-8333-333333333333",
        taskKind: "projection.reconcile",
        entityId: "mongo-user-id",
        entityVersion: "6",
        idempotencyKey: "reconcile:mongo-user-id:6",
        availableAt: now,
        attempt: 0,
      } as const;
    expect(projectionTaskSchema.parse(task).taskKind).toBe(
      "projection.reconcile",
    );
    const taskRow = toProjectionTaskPersistenceRow(task);
    expect(taskRow).toMatchObject({
      task_kind: "projection.reconcile",
      entity_version: "6",
      status: "queued",
      attempts: 0,
      max_attempts: 8,
      lease_owner: null,
      lease_token: null,
      lease_until: null,
    });
    expectExactKeys(taskRow, [
      "schema_version",
      "task_id",
      "task_kind",
      "entity_id",
      "entity_version",
      "idempotency_key",
      "status",
      "available_at",
      "lease_owner",
      "lease_token",
      "lease_until",
      "attempts",
      "max_attempts",
      "last_error_code",
    ]);
    expect(() =>
      projectionTaskPersistenceRowSchema.parse({
        ...taskRow,
        attempt: 0,
      }),
    ).toThrow();
    expect(
      matchingRollbackControlsSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        profileProducerEnabled: false,
        actionProducerEnabled: false,
        consentProducerEnabled: false,
        relayEnabled: false,
        servingEnabled: false,
      }).relayEnabled,
    ).toBeFalse();
  });

  test("does not expose unsigned hybrid contracts", () => {
    for (const forbiddenExport of [
      "candidateMatchGenerationSchema",
      "candidateJobMatchSchema",
      "generationFanoutTaskSchema",
      "generationActivationSchema",
    ]) {
      expect(forbiddenExport in matchingContracts).toBeFalse();
    }
    for (const forbiddenKind of [
      "candidate.generation.build",
      "candidate.match.materialize",
      "generation.fanout",
    ]) {
      expect(() => projectionTaskKindSchema.parse(forbiddenKind)).toThrow();
    }
  });
});
