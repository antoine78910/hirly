import { describe, expect, test } from "bun:test";
import { MATCHING_CONTRACT_VERSION, type OnlineMatchResponse } from "@hirly/contracts";
import {
  DISABLED_SHADOW_CANARY_CONTROLS,
  ONLINE_V2_PARITY_DIGEST_VERSION,
  PARIS_FULLSTACK_SUPPLY_GATE,
  digestOnlineV2Domain,
  evaluateShadowCanary,
  type OnlineV2DomainRecord,
  type ShadowCanaryControls,
  type ShadowObservation,
  type SupplyScorecardGate,
} from "../src";

const groupA = "00000000-0000-4000-8000-000000000001";
const groupB = "00000000-0000-4000-8000-000000000002";
function response(
  ids: readonly string[],
  emptyReason: OnlineMatchResponse["emptyReason"] = null,
): OnlineMatchResponse {
  return {
    schemaVersion: MATCHING_CONTRACT_VERSION,
    candidateId: "candidate-shadow",
    profileVersion: "7",
    actionWatermark: "9",
    matcherVersion: "legacy-or-v2",
    coarseCandidateCount: ids.length,
    eligibleCount: ids.length,
    hiddenCount: 0,
    emptyReason,
    results: ids.map((canonicalGroupId, index) => ({
      canonicalGroupId,
      preferredJobId: `job-${index}`,
      jobVersion: "3",
      relevanceScore: 0.9 - index * 0.1,
      fulfillmentRoute: index === 0 ? "manual" : "assisted",
      explanationCodes: ["role_match", index === 0 ? "manual_route" : "assisted_route"],
    })),
  };
}

const domain: OnlineV2DomainRecord[] = [
  {
    canonicalGroupId: groupA,
    eligible: true,
    statusReasons: ["fresh", "active"],
    componentScores: { skills: 0.5, role: 1 },
    relevanceScore: 0.9,
    fulfillmentRoute: "manual",
    explanationCodes: ["manual_route", "role_match"],
  },
];
const observation: ShadowObservation = {
  legacy: response([groupA, groupB]),
  onlineV2: response([groupA]),
  onlineV2Domain: domain,
  legacyLatencyMs: 20,
  onlineV2LatencyMs: 24,
  queryPlan: {
    requiredIndexes: ["job_search_documents_retrieval_idx", "job_search_documents_features_idx"],
    usedIndexes: ["job_search_documents_features_idx", "job_search_documents_retrieval_idx"],
    sequentialScan: false,
  },
};
const gate: SupplyScorecardGate = {
  gateId: PARIS_FULLSTACK_SUPPLY_GATE,
  city: "Paris",
  radiusKm: 52,
  countryCode: "FR",
  roleFamilyId: "fullstack",
  freshVisibleCanonicalGroups: 12,
  minimumRequired: 12,
  recordedAt: "2026-07-21T00:00:00Z",
  expiresAt: "2026-07-22T00:00:00Z",
};
const enabled: ShadowCanaryControls = {
  shadowEnabled: true,
  canaryEnabled: true,
  rollbackRequested: false,
  sampleRateBasisPoints: 10_000,
  selectors: [{ cohort: "paid", countryCode: "FR", roleFamilyId: "fullstack" }],
  requiredSupplyGates: [PARIS_FULLSTACK_SUPPLY_GATE],
};
const context = {
  candidateId: "candidate-shadow",
  cohort: "paid",
  countryCode: "FR",
  roleFamilyId: "fullstack",
};
const now = new Date("2026-07-21T12:00:00Z");

describe("G008 PR6 shadow and canary foundation", () => {
  test("is immutable and disabled with fail-closed rollback defaults", () => {
    expect(DISABLED_SHADOW_CANARY_CONTROLS).toEqual({
      shadowEnabled: false,
      canaryEnabled: false,
      rollbackRequested: true,
      sampleRateBasisPoints: 0,
      selectors: [],
      requiredSupplyGates: [PARIS_FULLSTACK_SUPPLY_GATE],
    });
    expect(
      evaluateShadowCanary(DISABLED_SHADOW_CANARY_CONTROLS, context, observation, [gate], now),
    ).toEqual({
      exposedResponse: observation.legacy,
      shadowExecuted: false,
      sampled: false,
      canaryAuthorized: false,
      rollbackReason: "ROLLBACK_REQUESTED",
      parityDigest: null,
      metrics: null,
    });
  });

  test("freezes a stable order-independent online-v2 domain parity digest", () => {
    const reordered = [
      {
        ...domain[0],
        statusReasons: [...domain[0].statusReasons].reverse(),
        explanationCodes: [...domain[0].explanationCodes].reverse(),
        componentScores: { role: 1, skills: 0.5 },
      },
    ];
    expect(digestOnlineV2Domain(reordered)).toEqual(digestOnlineV2Domain(domain));
    expect(digestOnlineV2Domain(domain)).toMatchObject({
      version: ONLINE_V2_PARITY_DIGEST_VERSION,
      algorithm: "sha256",
      recordCount: 1,
    });
  });

  test("samples and compares parity metrics while never exposing online-v2", () => {
    const decision = evaluateShadowCanary(enabled, context, observation, [gate], now);
    expect(decision.exposedResponse).toBe(observation.legacy);
    expect(decision.canaryAuthorized).toBe(true);
    expect(decision.parityDigest?.recordCount).toBe(1);
    expect(decision.metrics).toMatchObject({
      legacyEligibleCanonicalGroups: [groupA, groupB],
      onlineV2EligibleCanonicalGroups: [groupA],
      eligibleSetSymmetricDifference: [groupB],
      legacyRouteMix: { manual: 1, assisted: 1 },
      onlineV2RouteMix: { manual: 1 },
      exactOrderMatch: false,
      commonPrefixLength: 1,
      emptyReasonMatch: true,
      latencyDeltaMs: 4,
      queryPlanReady: true,
      missingRequiredIndexes: [],
    });
  });

  test("requires exact rollout scope, Paris supply, query plan, and rollback clearance", () => {
    expect(
      evaluateShadowCanary(enabled, { ...context, countryCode: "US" }, observation, [gate], now)
        .rollbackReason,
    ).toBe("ROLLOUT_SCOPE_DENIED");
    expect(evaluateShadowCanary(enabled, context, observation, [], now).rollbackReason).toBe(
      `SUPPLY_GATE_MISSING:${PARIS_FULLSTACK_SUPPLY_GATE}`,
    );
    expect(
      evaluateShadowCanary(enabled, context, observation, [{ ...gate, radiusKm: 51 }], now)
        .rollbackReason,
    ).toBe(`SUPPLY_GATE_SCOPE_MISMATCH:${PARIS_FULLSTACK_SUPPLY_GATE}`);
    expect(
      evaluateShadowCanary(
        enabled,
        context,
        { ...observation, queryPlan: { ...observation.queryPlan, sequentialScan: true } },
        [gate],
        now,
      ).rollbackReason,
    ).toBe("QUERY_PLAN_GATE_FAILED");
    expect(
      evaluateShadowCanary(
        { ...enabled, rollbackRequested: true },
        context,
        observation,
        [gate],
        now,
      ).rollbackReason,
    ).toBe("ROLLBACK_REQUESTED");
  });

  test("rejects unsafe control combinations", () => {
    expect(() =>
      evaluateShadowCanary({ ...enabled, shadowEnabled: false }, context, observation, [gate], now),
    ).toThrow("canary requires shadow");
    expect(() =>
      evaluateShadowCanary(
        { ...enabled, sampleRateBasisPoints: 10_001 },
        context,
        observation,
        [gate],
        now,
      ),
    ).toThrow("sample rate");
  });
});
