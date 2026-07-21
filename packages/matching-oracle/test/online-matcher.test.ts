import { describe, expect, test } from "bun:test";
import {
  MATCHING_CONTRACT_VERSION,
  onlineMatchResponseSchema,
  type CandidateActionProjection,
  type CandidateSearchProfile,
  type JobSearchDocument,
  type OnlineMatchRequest,
} from "@hirly/contracts";
import { matchOnline, type OnlineMatcherSnapshot } from "../src";

const now = "2026-07-21T12:00:00Z";
const request: OnlineMatchRequest = {
  schemaVersion: MATCHING_CONTRACT_VERSION,
  candidateId: "candidate-1",
  profileVersion: "7",
  actionWatermark: "9",
  matcherVersion: "online-first.v1",
  requestedAt: now,
  coarseLimit: 2,
  resultLimit: 1,
};
const profile: CandidateSearchProfile = {
  schemaVersion: MATCHING_CONTRACT_VERSION,
  candidateId: "candidate-1",
  version: "7",
  status: "active",
  targetRoleLabelNormalized: "software engineer",
  targetRoleLabelsNormalized: ["software engineer"],
  roleFamilyIds: ["software-engineering"],
  sectorIds: ["software-engineering"],
  industryIds: [],
  romeCodes: [],
  skillIds: ["typescript"],
  skillTerms: ["typescript"],
  seniorityMin: 2,
  seniorityMax: 6,
  contractTypes: ["permanent"],
  workModes: ["remote"],
  originLatitude: null,
  originLongitude: null,
  radiusKm: null,
  countryCodes: ["FR"],
  locationPolicy: "country",
  salaryFloor: null,
  currency: null,
  freshnessWindowDays: 30,
  exposurePolicyVersion: "1",
  featureSchemaVersion: "matching-features.v1",
  sourceProfileUpdatedAt: now,
  projectedAt: now,
};

function job(id: string, overrides: Partial<JobSearchDocument> = {}): JobSearchDocument {
  return {
    schemaVersion: MATCHING_CONTRACT_VERSION,
    canonicalGroupId: id,
    preferredJobId: `job-${id}`,
    jobVersion: "3",
    roleFamilyIds: ["software-engineering"],
    sectorIds: ["software-engineering"],
    industryIds: [],
    romeCodes: [],
    skillIds: ["typescript"],
    seniorityMin: 2,
    seniorityMax: 5,
    contractTypes: ["permanent"],
    workModes: ["remote"],
    latitude: 48.8566,
    longitude: 2.3522,
    countryCode: "FR",
    locationConfidence: 1,
    locationUnknown: false,
    publishedAt: "2026-07-20T12:00:00Z",
    lastSeenAt: now,
    expiresAt: null,
    lifecycleStatus: "active",
    validationStatus: "valid",
    applyabilityTier: "B",
    fulfillmentRoute: "manual",
    sourceEligible: true,
    policyEligible: true,
    featureSchemaVersion: "matching-features.v1",
    projectedAt: now,
    ...overrides,
  };
}

const bestId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const aliasId = "00000000-0000-4000-8000-000000000003";
const action: CandidateActionProjection = {
  schemaVersion: MATCHING_CONTRACT_VERSION,
  candidateId: "candidate-1",
  sourceActionId: "action-1",
  sourceJobId: "old-job",
  canonicalGroupId: aliasId,
  canonicalGroupAliases: [],
  kind: "seen",
  version: "9",
  occurredAt: now,
  retentionState: "active",
  projectedAt: now,
};

function snapshot(overrides: Partial<OnlineMatcherSnapshot> = {}): OnlineMatcherSnapshot {
  return {
    servingEnabled: true,
    profile,
    actionWatermark: "9",
    actions: [],
    jobs: [job(secondId), job(bestId)],
    ...overrides,
  };
}

describe("G006 deterministic ONLINE_FIRST matcher", () => {
  test("emits a bounded G003-valid response with deterministic canonical tie breaking", () => {
    const forward = matchOnline(request, snapshot());
    const reverse = matchOnline(request, snapshot({ jobs: [...snapshot().jobs].reverse() }));

    expect(reverse).toEqual(forward);
    expect(onlineMatchResponseSchema.parse(forward)).toEqual(forward);
    expect(forward.results).toHaveLength(1);
    expect(forward.results[0]).toMatchObject({
      canonicalGroupId: bestId,
      jobVersion: "3",
      fulfillmentRoute: "manual",
      explanationCodes: [
        "role_match", "skill_match", "remote_match", "contract_match",
        "fresh_inventory", "quality_inventory", "manual_route",
      ],
    });
    expect(forward.matcherVersion).toBe(request.matcherVersion);
    expect(forward.profileVersion).toBe(request.profileVersion);
    expect(forward.actionWatermark).toBe(request.actionWatermark);
    expect(forward.coarseCandidateCount).toBe(2);
  });

  test("excludes action aliases before top-K and collapses duplicate group versions", () => {
    const result = matchOnline(request, snapshot({
      actions: [action],
      aliases: [{ aliasGroupId: aliasId, canonicalGroupId: bestId }],
      jobs: [job(bestId, { jobVersion: "2" }), job(bestId, { jobVersion: "4" }), job(secondId)],
    }));

    expect(result.results.map((entry) => entry.canonicalGroupId)).toEqual([secondId]);
    expect(result.coarseCandidateCount).toBe(1);
  });

  test("fails closed for disabled serving and projection/version fences", () => {
    expect(() => matchOnline(request, snapshot({ servingEnabled: false }))).toThrow("ONLINE_MATCH_DISABLED");
    expect(matchOnline(request, snapshot({ profile: null })).emptyReason).toBe("PROJECTION_LAG");
    expect(matchOnline(request, snapshot({ profileTombstoned: true })).emptyReason).toBe("DELETION_PENDING");
    expect(matchOnline(request, snapshot({ actionWatermark: "8" })).emptyReason).toBe("PROJECTION_LAG");
    expect(matchOnline(request, snapshot({ reconciliationRequired: true })).emptyReason).toBe("PROJECTION_LAG");
    expect(matchOnline(request, snapshot({
      profile: { ...profile, status: "paused" } as CandidateSearchProfile,
    })).emptyReason).toBe("PROFILE_INACTIVE");
  });

  test("hard-filters policy, lifecycle, validation, freshness, route and candidate constraints", () => {
    const hidden = [
      job(bestId, { policyEligible: false }),
      job(secondId, { sourceEligible: false }),
      job(aliasId, { fulfillmentRoute: "blocked" }),
    ];
    expect(matchOnline(request, snapshot({ jobs: hidden })).emptyReason).toBe("ALL_POLICY_HIDDEN");
    expect(matchOnline(request, snapshot({ jobs: [job(bestId, { lifecycleStatus: "expired" })] })).emptyReason).toBe("NO_ELIGIBLE_INVENTORY");
    expect(matchOnline(request, snapshot({ jobs: [job(bestId, { validationStatus: "invalid" })] })).emptyReason).toBe("NO_ELIGIBLE_INVENTORY");
    expect(matchOnline(request, snapshot({ jobs: [job(bestId, { countryCode: "US" })] })).emptyReason).toBe("NO_MATCHING_INVENTORY");
    expect(matchOnline(request, snapshot({ jobs: [job(bestId, { publishedAt: "2026-01-01T00:00:00Z" })] })).emptyReason).toBe("NO_FRESH_INVENTORY");
    expect(matchOnline(request, snapshot({ actions: [{ ...action, canonicalGroupId: bestId }], jobs: [job(bestId)] })).emptyReason).toBe("ALL_ACTIONED");
  });
});
