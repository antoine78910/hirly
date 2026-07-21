import { describe, expect, test } from "bun:test";
import * as matchingContracts from "../src/matching";
import {
  MATCHING_CONTRACT_VERSION,
  candidateActionProjectionSchema,
  candidateProjectionOutboxEventSchema,
  candidateSearchProfileSchema,
  jobSearchDocumentSchema,
  matchingRollbackControlsSchema,
  monotonicVersionSchema,
  onlineMatchRequestSchema,
  onlineMatchResponseSchema,
  projectionTaskKindSchema,
  projectionTaskSchema,
} from "../src/matching";

const now = "2026-07-21T04:00:00+00:00";
const groupId = "11111111-1111-4111-8111-111111111111";

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
    expect(
      candidateSearchProfileSchema.parse({
        ...candidateProfile,
        status: "deleted",
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
      }).status,
    ).toBe("deleted");
  });

  test("validates purpose-limited action and opaque outbox envelopes", () => {
    expect(
      candidateActionProjectionSchema.parse({
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
      }).sourceJobId,
    ).toBe("job-text-id");

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
    expect(
      projectionTaskSchema.parse({
        schemaVersion: MATCHING_CONTRACT_VERSION,
        taskId: "33333333-3333-4333-8333-333333333333",
        taskKind: "projection.reconcile",
        entityId: "mongo-user-id",
        entityVersion: "6",
        idempotencyKey: "reconcile:mongo-user-id:6",
        availableAt: now,
        attempt: 0,
      }).taskKind,
    ).toBe("projection.reconcile");
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
