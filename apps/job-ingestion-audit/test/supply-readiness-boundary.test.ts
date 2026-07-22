import { describe, expect, test } from "bun:test";
import {
  buildSupplyReadinessScorecard,
  PARIS_FULLSTACK_SEGMENT,
  type SupplyException,
  type SupplyObservation,
  type SupplyReadinessInput,
} from "../src/supply-readiness";

const generatedAt = "2026-07-21T08:00:00.000Z";

function observations(count: number): SupplyObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    canonicalGroupId: `paris-fullstack-${String(index + 1).padStart(2, "0")}`,
    countryCode: "FR",
    cohortIds: ["paris-52km"],
    roleFamilyIds: ["fullstack-engineering"],
    fresh: true,
    visible: true,
    fulfillmentRoute: (["auto", "assisted", "manual"] as const)[index % 3]!,
  }));
}

function completeInput(count = 12): SupplyReadinessInput {
  return {
    status: "COMPLETE",
    sample: false,
    environment: "production_like",
    evidenceId: "paris-supply-census-2026-07-21",
    sourceDigest: "a".repeat(64),
    cohortDigest: "b".repeat(64),
    canonicalIdentityContract: "canonical_group_id_only" as const,
    eligibilityContract: "active_valid_fresh_visible_canonical_groups" as const,
    generatedAt,
    freshnessCutoff: "2026-06-21T08:00:00.000Z",
    segment: { ...PARIS_FULLSTACK_SEGMENT },
    threshold: {
      thresholdId: "prd-paris-fullstack-v1",
      segment: { ...PARIS_FULLSTACK_SEGMENT },
      minimumFreshVisibleCanonicalGroups: 12,
      approvedByProduct: "product-owner",
      approvedAt: "2026-07-20T08:00:00.000Z",
    },
    observations: observations(count),
  };
}

function supplyException(overrides: Partial<SupplyException> = {}): SupplyException {
  return {
    exceptionId: "upstream-supply-incident-2026-07",
    name: "Paris Fullstack upstream supply incident",
    segment: { ...PARIS_FULLSTACK_SEGMENT },
    minimumFreshVisibleCanonicalGroups: 8,
    approvedByProduct: "product-owner",
    approvedAt: "2026-07-20T09:00:00.000Z",
    expiresAt: "2026-07-28T09:00:00.000Z",
    reason: "Temporary upstream provider inventory incident.",
    ...overrides,
  };
}

describe("PR0-S scorecard boundary regressions", () => {
  test("is deterministic when evidence observations are reordered", () => {
    const forward = completeInput();
    const reversed = completeInput();
    reversed.observations = [...reversed.observations!].reverse();

    expect(buildSupplyReadinessScorecard(reversed)).toEqual(buildSupplyReadinessScorecard(forward));
  });

  test("treats an exception expiring exactly at evaluation time as expired", () => {
    const scorecard = buildSupplyReadinessScorecard(completeInput(8), {
      exception: supplyException({ expiresAt: generatedAt }),
      evaluatedAt: generatedAt,
    });

    expect(scorecard).toMatchObject({
      status: "BLOCKED",
      supplyGateSatisfied: false,
      appliedMinimumFreshVisibleCanonicalGroups: 12,
      appliedException: null,
      failedGates: [
        "fresh_visible_canonical_groups_below_approved_minimum",
        "supply_exception_expired",
      ],
    });
  });

  test("fails closed on absent, future, or wrong-segment Product approval", () => {
    expect(() =>
      buildSupplyReadinessScorecard(completeInput(8), {
        exception: supplyException({ approvedByProduct: "" }),
      }),
    ).toThrow("SUPPLY_READINESS_REFUSED");

    expect(() =>
      buildSupplyReadinessScorecard(completeInput(8), {
        exception: supplyException({ approvedAt: "2026-07-22T09:00:00.000Z" }),
        evaluatedAt: "2026-07-21T09:00:00.000Z",
      }),
    ).toThrow("exception approval is later than evaluation time");

    expect(() =>
      buildSupplyReadinessScorecard(completeInput(8), {
        exception: supplyException({
          segment: {
            countryCode: "FR",
            cohortId: "lyon-35km",
            roleFamilyId: "fullstack-engineering",
          },
        }),
      }),
    ).toThrow("exception segment does not match scorecard segment");
  });

  test("refuses malformed runtime booleans instead of scoring truthy values", () => {
    const input = completeInput();
    input.observations = input.observations!.map((observation, index) =>
      index === 0 ? { ...observation, fresh: "yes" as unknown as boolean } : observation,
    );

    expect(() => buildSupplyReadinessScorecard(input)).toThrow("SUPPLY_READINESS_REFUSED");
  });

  test("keeps scorecards informational rather than authorizing rollout", () => {
    const scorecard = buildSupplyReadinessScorecard(completeInput());
    expect(scorecard.safeguards).toEqual({
      readOnly: true,
      aggregateOnly: true,
      canonicalWrites: false,
      featureFlagChanges: false,
      exposureAuthorized: false,
      servingBranchSelection: false,
    });
    expect(JSON.stringify(scorecard)).not.toMatch(/ONLINE_FIRST|HYBRID_HOT_COHORT/);
  });
});
