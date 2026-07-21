import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildSupplyReadinessScorecard,
  PARIS_FULLSTACK_MIN_FRESH_VISIBLE_GROUPS,
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
    canonicalIdentityContract: "canonical_group_id_only",
    eligibilityContract: "active_valid_fresh_visible_canonical_groups",
    generatedAt,
    freshnessCutoff: "2026-06-21T08:00:00.000Z",
    segment: { ...PARIS_FULLSTACK_SEGMENT },
    threshold: {
      thresholdId: "prd-paris-fullstack-v1",
      segment: { ...PARIS_FULLSTACK_SEGMENT },
      minimumFreshVisibleCanonicalGroups:
        PARIS_FULLSTACK_MIN_FRESH_VISIBLE_GROUPS,
      approvedByProduct: "product-owner",
      approvedAt: "2026-07-20T08:00:00.000Z",
    },
    observations: observations(count),
  };
}

function exception(overrides: Partial<SupplyException> = {}): SupplyException {
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

describe("PR0-S supply readiness", () => {
  test("proves the Paris/52 km/Fullstack gate with 12 distinct fresh visible groups", () => {
    const scorecard = buildSupplyReadinessScorecard(completeInput());

    expect(PARIS_FULLSTACK_MIN_FRESH_VISIBLE_GROUPS).toBe(12);
    expect(scorecard).toMatchObject({
      status: "READY",
      scoreable: true,
      supplyGateSatisfied: true,
      segment: PARIS_FULLSTACK_SEGMENT,
      appliedMinimumFreshVisibleCanonicalGroups: 12,
      counts: {
        segmentCanonicalGroups: 12,
        freshCanonicalGroups: 12,
        visibleCanonicalGroups: 12,
        freshVisibleCanonicalGroups: 12,
        freshVisibleByFulfillmentRoute: {
          auto: 4,
          assisted: 4,
          manual: 4,
          blocked: 0,
        },
      },
      appliedException: null,
      failedGates: [],
      safeguards: {
        readOnly: true,
        aggregateOnly: true,
        canonicalWrites: false,
        featureFlagChanges: false,
        exposureAuthorized: false,
        servingBranchSelection: false,
      },
    });
    expect(scorecard.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("blocks exact Paris exposure when production-like supply is below 12", () => {
    const scorecard = buildSupplyReadinessScorecard(completeInput(11));
    expect(scorecard).toMatchObject({
      status: "BLOCKED",
      supplyGateSatisfied: false,
      appliedMinimumFreshVisibleCanonicalGroups: 12,
      failedGates: ["fresh_visible_canonical_groups_below_approved_minimum"],
    });
  });

  test("keeps the aggregate scorecard and digest stable when observations reorder", () => {
    const forward = completeInput();
    const reversed = completeInput();
    reversed.observations = [...reversed.observations!].reverse();
    expect(buildSupplyReadinessScorecard(reversed))
      .toEqual(buildSupplyReadinessScorecard(forward));
  });

  test("accepts only a matching named Product-approved unexpired lower-threshold exception", () => {
    const scorecard = buildSupplyReadinessScorecard(completeInput(8), {
      exception: exception(),
      evaluatedAt: "2026-07-21T09:00:00.000Z",
    });
    expect(scorecard).toMatchObject({
      status: "EXCEPTION",
      supplyGateSatisfied: true,
      appliedMinimumFreshVisibleCanonicalGroups: 8,
      appliedException: {
        exceptionId: "upstream-supply-incident-2026-07",
        name: "Paris Fullstack upstream supply incident",
        approvedByProduct: "product-owner",
        expiresAt: "2026-07-28T09:00:00.000Z",
      },
      failedGates: [],
    });

    const expired = buildSupplyReadinessScorecard(completeInput(8), {
      exception: exception({ expiresAt: "2026-07-21T08:30:00.000Z" }),
      evaluatedAt: "2026-07-21T09:00:00.000Z",
    });
    expect(expired.status).toBe("BLOCKED");
    expect(expired.failedGates).toEqual([
      "fresh_visible_canonical_groups_below_approved_minimum",
      "supply_exception_expired",
    ]);
  });

  test("rejects exceptions with scope drift or a non-lower threshold", () => {
    expect(() => buildSupplyReadinessScorecard(completeInput(8), {
      exception: exception({
        segment: {
          countryCode: "FR",
          cohortId: "lyon-50km",
          roleFamilyId: "fullstack-engineering",
          radiusKm: 50,
        },
      }),
    })).toThrow("exception segment does not match");
    expect(() => buildSupplyReadinessScorecard(completeInput(8), {
      exception: exception({ minimumFreshVisibleCanonicalGroups: 12 }),
    })).toThrow("exception minimum must be lower");
  });

  test("keeps fixture evidence and duplicate canonical groups from satisfying PR0-S", () => {
    expect(() => buildSupplyReadinessScorecard({
      ...completeInput(),
      environment: "fixture",
    })).toThrow("fixture evidence cannot establish supply readiness");
    expect(() => buildSupplyReadinessScorecard({
      ...completeInput(),
      observations: [observations(1)[0]!, observations(1)[0]!],
    })).toThrow("duplicate canonical group");
  });

  test("refuses malformed runtime booleans instead of scoring truthy values", () => {
    const input = completeInput();
    input.observations = input.observations!.map((observation, index) =>
      index === 0
        ? { ...observation, fresh: "yes" as unknown as boolean }
        : observation);
    expect(() => buildSupplyReadinessScorecard(input))
      .toThrow("observations[0].fresh must be boolean");
  });

  test("records unavailable Paris production-like evidence as non-scoreable and blocked", () => {
    const scorecard = buildSupplyReadinessScorecard({
      ...completeInput(),
      status: "BLOCKED_EXTERNAL",
      blockerReason: "production-like inventory capture is unavailable",
      observations: undefined,
    });
    expect(scorecard).toMatchObject({
      status: "BLOCKED",
      scoreable: false,
      supplyGateSatisfied: false,
      counts: {
        segmentCanonicalGroups: null,
        freshVisibleCanonicalGroups: null,
      },
      failedGates: ["production_like_supply_evidence_unavailable"],
      blockerReason: "production-like inventory capture is unavailable",
    });
  });

  test("reuses the same gate for another country/cohort/role-family segment", () => {
    const segment = {
      countryCode: "DE",
      cohortId: "berlin-40km-paid",
      roleFamilyId: "data-engineering",
      radiusKm: 40,
    };
    const scorecard = buildSupplyReadinessScorecard({
      ...completeInput(3),
      evidenceId: "berlin-data-supply-census",
      segment,
      threshold: {
        thresholdId: "berlin-data-paid-v1",
        segment,
        minimumFreshVisibleCanonicalGroups: 3,
        approvedByProduct: "product-owner",
        approvedAt: "2026-07-20T08:00:00.000Z",
      },
      observations: observations(3).map((observation) => ({
        ...observation,
        countryCode: "DE",
        cohortIds: ["berlin-40km-paid"],
        roleFamilyIds: ["data-engineering"],
      })),
    });
    expect(scorecard.status).toBe("READY");
    expect(scorecard.segment).toEqual(segment);
  });

  test("contains no production mutation, routing, or network surface", () => {
    const source = readFileSync(
      new URL("../src/supply-readiness.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i,
    );
    expect(source).not.toMatch(/\bfetch\s*\(|https?:\/\//i);
    expect(source).not.toContain(".omx/ultragoal");
  });

  test("binds the canonical source snapshot and refuses provider-fallback contracts", () => {
    const scorecard = buildSupplyReadinessScorecard(completeInput());
    expect(scorecard.evidenceBinding).toEqual({
      sourceDigest: "a".repeat(64),
      cohortDigest: "b".repeat(64),
      canonicalIdentityContract: "canonical_group_id_only",
      eligibilityContract: "active_valid_fresh_visible_canonical_groups",
    });
    expect(() => buildSupplyReadinessScorecard({
      ...completeInput(),
      sourceDigest: "not-a-digest",
    })).toThrow("sourceDigest must be a SHA-256 value");
    expect(() => buildSupplyReadinessScorecard({
      ...completeInput(),
      canonicalIdentityContract: "provider_external_id" as "canonical_group_id_only",
    })).toThrow("exclude provider fallback identities");
  });
});
