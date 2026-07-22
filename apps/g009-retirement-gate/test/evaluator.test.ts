import { describe, expect, test } from "bun:test";
import { evaluateG009RetirementGate } from "../src/evaluator";

const healthy = {
  evidenceKind: "production" as const,
  evidenceRefs: ["metrics://g009/window-2026-07"],
  instrumentationReady: true,
  healthyDays: 30,
  v2Requests: 10_000,
  activePaidProfilesCovered: 800,
  activePaidProfilesTotal: 1_000,
  duplicateSubmissionBreaches: 0,
  resurfacingBreaches: 0,
  legacySuccessRatePercent: 72,
  v2SuccessRatePercent: 72,
  lowerConfidenceBoundDeltaPercentagePoints: -1.5,
  rollbackTested: true,
  rollbackHealthy: true,
};

describe("G009 retirement gate", () => {
  test("defaults to NOT_AUTHORIZED with explicit missing evidence reasons", () => {
    const evidence = evaluateG009RetirementGate();
    expect(evidence.implementationStatus).toBe("NOT_READY");
    expect(evidence.retirementStatus).toBe("NOT_AUTHORIZED");
    expect(evidence.unmetReasons).toContain("healthy_days_missing");
    expect(evidence.unmetReasons).toContain("production_evidence_required");
  });

  test("authorizes only complete production evidence at every threshold", () => {
    const evidence = evaluateG009RetirementGate(healthy);
    expect(evidence.implementationStatus).toBe("READY");
    expect(evidence.retirementStatus).toBe("AUTHORIZED");
    expect(evidence.unmetReasons).toEqual([]);
  });

  test("distinguishes implementation readiness from retirement authorization", () => {
    const evidence = evaluateG009RetirementGate({ ...healthy, evidenceKind: "fixture" });
    expect(evidence.implementationStatus).toBe("READY");
    expect(evidence.retirementStatus).toBe("NOT_AUTHORIZED");
    expect(evidence.unmetReasons).toEqual(["production_evidence_required"]);
  });

  test("fails closed on breaches, insufficient windows, coverage, and non-inferiority", () => {
    const evidence = evaluateG009RetirementGate({
      ...healthy,
      healthyDays: 29,
      v2Requests: 9_999,
      activePaidProfilesCovered: 799,
      duplicateSubmissionBreaches: 1,
      resurfacingBreaches: 1,
      lowerConfidenceBoundDeltaPercentagePoints: -2.01,
      rollbackHealthy: false,
    });
    expect(evidence.retirementStatus).toBe("NOT_AUTHORIZED");
    expect(evidence.unmetReasons).toEqual([
      "active_paid_coverage_below_80_percent",
      "duplicate_submission_breach_detected",
      "healthy_days_below_30",
      "non_inferiority_not_met",
      "resurfacing_breach_detected",
      "rollback_not_healthy",
      "v2_requests_below_10000",
    ]);
  });

  test("is deterministic and sorts evidence references and reasons", () => {
    const input = { ...healthy, evidenceRefs: ["z", "a", "z"], rollbackTested: false };
    expect(JSON.stringify(evaluateG009RetirementGate(input))).toBe(
      JSON.stringify(evaluateG009RetirementGate(input)),
    );
    expect(evaluateG009RetirementGate(input).evidenceRefs).toEqual(["a", "z"]);
  });

  test("fails closed when quantitative counters are fractional", () => {
    const evidence = evaluateG009RetirementGate({
      ...healthy,
      healthyDays: 30.5,
      v2Requests: 10_000.1,
      activePaidProfilesCovered: 800.5,
      duplicateSubmissionBreaches: 0.5,
      resurfacingBreaches: 0.5,
    });

    expect(evidence.retirementStatus).toBe("NOT_AUTHORIZED");
    expect(evidence.invariantFailures).toEqual([
      "active_paid_profile_counts_must_be_whole_counts",
      "duplicate_submission_breaches_must_be_a_whole_count",
      "healthy_days_must_be_a_whole_count",
      "resurfacing_breaches_must_be_a_whole_count",
      "v2_requests_must_be_a_whole_count",
    ]);
    expect(evidence.unmetReasons).toContain("active_paid_coverage_missing");
  });

  test("rejects an impossible confidence interval lower bound", () => {
    const evidence = evaluateG009RetirementGate({
      ...healthy,
      v2SuccessRatePercent: 70,
      lowerConfidenceBoundDeltaPercentagePoints: -1,
    });

    expect(evidence.retirementStatus).toBe("NOT_AUTHORIZED");
    expect(evidence.invariantFailures).toEqual(["lower_confidence_bound_exceeds_observed_delta"]);
    expect(evidence.unmetReasons).toContain("lower_confidence_bound_exceeds_observed_delta");
  });
});
