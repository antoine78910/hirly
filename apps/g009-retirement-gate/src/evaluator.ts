export const G009_RETIREMENT_THRESHOLDS = {
  healthyDays: 30,
  v2Requests: 10_000,
  activePaidCoveragePercent: 80,
  maxDuplicateSubmissionBreaches: 0,
  maxResurfacingBreaches: 0,
  maxNonInferiorityRegressionPercentagePoints: 2,
} as const;

export interface G009RetirementGateInput {
  evidenceKind?: "none" | "fixture" | "production";
  evidenceRefs?: string[];
  instrumentationReady?: boolean;
  healthyDays?: number;
  v2Requests?: number;
  activePaidProfilesCovered?: number;
  activePaidProfilesTotal?: number;
  duplicateSubmissionBreaches?: number;
  resurfacingBreaches?: number;
  legacySuccessRatePercent?: number;
  v2SuccessRatePercent?: number;
  lowerConfidenceBoundDeltaPercentagePoints?: number;
  rollbackTested?: boolean;
  rollbackHealthy?: boolean;
}

export interface G009RetirementGateEvidence {
  schemaVersion: "hirly.g009-retirement-gate.v1";
  implementationStatus: "READY" | "NOT_READY";
  retirementStatus: "AUTHORIZED" | "NOT_AUTHORIZED";
  evidenceKind: "none" | "fixture" | "production";
  thresholds: typeof G009_RETIREMENT_THRESHOLDS;
  measurements: {
    healthyDays: number | null;
    v2Requests: number | null;
    activePaidCoveragePercent: number | null;
    duplicateSubmissionBreaches: number | null;
    resurfacingBreaches: number | null;
    successRateDeltaPercentagePoints: number | null;
    lowerConfidenceBoundDeltaPercentagePoints: number | null;
    rollbackTested: boolean;
    rollbackHealthy: boolean;
  };
  unmetReasons: string[];
  evidenceRefs: string[];
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function rate(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function coverage(input: G009RetirementGateInput): number | null {
  const covered = finiteNonNegative(input.activePaidProfilesCovered);
  const total = finiteNonNegative(input.activePaidProfilesTotal);
  if (covered === null || total === null || total === 0 || covered > total) return null;
  return Math.round((covered / total) * 10_000) / 100;
}

export function evaluateG009RetirementGate(
  input: G009RetirementGateInput = {},
): G009RetirementGateEvidence {
  const evidenceKind = input.evidenceKind ?? "none";
  const healthyDays = finiteNonNegative(input.healthyDays);
  const v2Requests = finiteNonNegative(input.v2Requests);
  const paidCoverage = coverage(input);
  const duplicateBreaches = finiteNonNegative(input.duplicateSubmissionBreaches);
  const resurfacingBreaches = finiteNonNegative(input.resurfacingBreaches);
  const legacyRate = rate(input.legacySuccessRatePercent);
  const v2Rate = rate(input.v2SuccessRatePercent);
  const delta = legacyRate === null || v2Rate === null
    ? null
    : Math.round((v2Rate - legacyRate) * 100) / 100;
  const lowerBound = typeof input.lowerConfidenceBoundDeltaPercentagePoints === "number"
    && Number.isFinite(input.lowerConfidenceBoundDeltaPercentagePoints)
    ? input.lowerConfidenceBoundDeltaPercentagePoints
    : null;
  const reasons: string[] = [];

  if (input.instrumentationReady !== true) reasons.push("instrumentation_not_ready");
  if (healthyDays === null) reasons.push("healthy_days_missing");
  else if (healthyDays < G009_RETIREMENT_THRESHOLDS.healthyDays) reasons.push("healthy_days_below_30");
  if (v2Requests === null) reasons.push("v2_requests_missing");
  else if (v2Requests < G009_RETIREMENT_THRESHOLDS.v2Requests) reasons.push("v2_requests_below_10000");
  if (paidCoverage === null) reasons.push("active_paid_coverage_missing");
  else if (paidCoverage < G009_RETIREMENT_THRESHOLDS.activePaidCoveragePercent) reasons.push("active_paid_coverage_below_80_percent");
  if (duplicateBreaches === null) reasons.push("duplicate_submission_breaches_missing");
  else if (duplicateBreaches > 0) reasons.push("duplicate_submission_breach_detected");
  if (resurfacingBreaches === null) reasons.push("resurfacing_breaches_missing");
  else if (resurfacingBreaches > 0) reasons.push("resurfacing_breach_detected");
  if (delta === null || lowerBound === null) reasons.push("non_inferiority_evidence_missing");
  else if (
    delta < -G009_RETIREMENT_THRESHOLDS.maxNonInferiorityRegressionPercentagePoints
    || lowerBound < -G009_RETIREMENT_THRESHOLDS.maxNonInferiorityRegressionPercentagePoints
  ) reasons.push("non_inferiority_not_met");
  if (input.rollbackTested !== true) reasons.push("rollback_not_tested");
  if (input.rollbackHealthy !== true) reasons.push("rollback_not_healthy");
  if (evidenceKind !== "production") reasons.push("production_evidence_required");
  const evidenceRefs = [...new Set((input.evidenceRefs ?? []).map((value) => value.trim()).filter(Boolean))].sort();
  if (evidenceKind === "production" && evidenceRefs.length === 0) reasons.push("production_evidence_refs_missing");

  const implementationBlockers = new Set([
    "instrumentation_not_ready",
    "healthy_days_missing",
    "v2_requests_missing",
    "active_paid_coverage_missing",
    "duplicate_submission_breaches_missing",
    "resurfacing_breaches_missing",
    "non_inferiority_evidence_missing",
    "rollback_not_tested",
  ]);
  const implementationReady = !reasons.some((reason) => implementationBlockers.has(reason));
  const unmetReasons = [...new Set(reasons)].sort();
  return {
    schemaVersion: "hirly.g009-retirement-gate.v1",
    implementationStatus: implementationReady ? "READY" : "NOT_READY",
    retirementStatus: unmetReasons.length === 0 ? "AUTHORIZED" : "NOT_AUTHORIZED",
    evidenceKind,
    thresholds: G009_RETIREMENT_THRESHOLDS,
    measurements: {
      healthyDays,
      v2Requests,
      activePaidCoveragePercent: paidCoverage,
      duplicateSubmissionBreaches: duplicateBreaches,
      resurfacingBreaches,
      successRateDeltaPercentagePoints: delta,
      lowerConfidenceBoundDeltaPercentagePoints: lowerBound,
      rollbackTested: input.rollbackTested === true,
      rollbackHealthy: input.rollbackHealthy === true,
    },
    unmetReasons,
    evidenceRefs,
  };
}
