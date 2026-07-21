import { createHash } from "node:crypto";
import type { OnlineMatchResponse } from "@hirly/contracts";

export const ONLINE_V2_PARITY_DIGEST_VERSION = "online-v2.parity.v1" as const;
export const PARIS_FULLSTACK_SUPPLY_GATE = "paris-52km-fullstack" as const;

export interface OnlineV2DomainRecord {
  canonicalGroupId: string;
  eligible: boolean;
  statusReasons: readonly string[];
  componentScores: Readonly<Record<string, number>>;
  relevanceScore: number;
  fulfillmentRoute: "auto" | "assisted" | "manual" | "blocked";
  explanationCodes: readonly string[];
}

export interface OnlineV2ParityDigest {
  version: typeof ONLINE_V2_PARITY_DIGEST_VERSION;
  algorithm: "sha256";
  digest: string;
  recordCount: number;
}

export interface RolloutSelector {
  cohort: string;
  countryCode: string;
  roleFamilyId: string;
}

export interface ShadowCanaryControls {
  shadowEnabled: boolean;
  canaryEnabled: boolean;
  rollbackRequested: boolean;
  sampleRateBasisPoints: number;
  selectors: readonly RolloutSelector[];
  requiredSupplyGates: readonly string[];
}

export const DISABLED_SHADOW_CANARY_CONTROLS: ShadowCanaryControls = Object.freeze({
  shadowEnabled: false,
  canaryEnabled: false,
  rollbackRequested: true,
  sampleRateBasisPoints: 0,
  selectors: Object.freeze([]),
  requiredSupplyGates: Object.freeze([PARIS_FULLSTACK_SUPPLY_GATE]),
});

export interface ShadowRequestContext extends RolloutSelector {
  candidateId: string;
}

export interface SupplyScorecardGate {
  gateId: string;
  city: string;
  radiusKm: number;
  countryCode: string;
  roleFamilyId: string;
  freshVisibleCanonicalGroups: number;
  minimumRequired: number;
  recordedAt: string;
  expiresAt: string;
}

export interface QueryPlanObservation {
  requiredIndexes: readonly string[];
  usedIndexes: readonly string[];
  sequentialScan: boolean;
}

export interface ShadowObservation {
  legacy: OnlineMatchResponse;
  onlineV2: OnlineMatchResponse;
  onlineV2Domain: readonly OnlineV2DomainRecord[];
  legacyLatencyMs: number;
  onlineV2LatencyMs: number;
  queryPlan: QueryPlanObservation;
}

export interface ShadowComparisonMetrics {
  legacyEligibleCanonicalGroups: readonly string[];
  onlineV2EligibleCanonicalGroups: readonly string[];
  eligibleSetSymmetricDifference: readonly string[];
  legacyRouteMix: Readonly<Record<string, number>>;
  onlineV2RouteMix: Readonly<Record<string, number>>;
  exactOrderMatch: boolean;
  commonPrefixLength: number;
  emptyReasonMatch: boolean;
  legacyLatencyMs: number;
  onlineV2LatencyMs: number;
  latencyDeltaMs: number;
  queryPlanReady: boolean;
  missingRequiredIndexes: readonly string[];
}

export interface ShadowCanaryDecision {
  exposedResponse: OnlineMatchResponse;
  shadowExecuted: boolean;
  sampled: boolean;
  canaryAuthorized: boolean;
  rollbackReason: string | null;
  parityDigest: OnlineV2ParityDigest | null;
  metrics: ShadowComparisonMetrics | null;
}

function normalizedDomainRecord(record: OnlineV2DomainRecord) {
  return {
    canonicalGroupId: record.canonicalGroupId,
    eligible: record.eligible,
    statusReasons: [...record.statusReasons].sort(),
    componentScores: Object.fromEntries(Object.entries(record.componentScores).sort(([a], [b]) => a.localeCompare(b))),
    relevanceScore: record.relevanceScore,
    fulfillmentRoute: record.fulfillmentRoute,
    explanationCodes: [...record.explanationCodes].sort(),
  };
}

export function digestOnlineV2Domain(records: readonly OnlineV2DomainRecord[]): OnlineV2ParityDigest {
  const payload = [...records]
    .map(normalizedDomainRecord)
    .sort((a, b) => a.canonicalGroupId.localeCompare(b.canonicalGroupId));
  return {
    version: ONLINE_V2_PARITY_DIGEST_VERSION,
    algorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    recordCount: payload.length,
  };
}

function validateControls(controls: ShadowCanaryControls): void {
  if (!Number.isInteger(controls.sampleRateBasisPoints)
    || controls.sampleRateBasisPoints < 0
    || controls.sampleRateBasisPoints > 10_000) {
    throw new Error("SHADOW_CANARY_REFUSED: sample rate must be 0..10000 basis points");
  }
  if (controls.canaryEnabled && !controls.shadowEnabled) {
    throw new Error("SHADOW_CANARY_REFUSED: canary requires shadow evaluation");
  }
}

function sampled(candidateId: string, basisPoints: number): boolean {
  if (basisPoints === 0) return false;
  const bucket = Number.parseInt(createHash("sha256").update(candidateId).digest("hex").slice(0, 8), 16) % 10_000;
  return bucket < basisPoints;
}

function routeMix(response: OnlineMatchResponse): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const result of response.results) mix[result.fulfillmentRoute] = (mix[result.fulfillmentRoute] ?? 0) + 1;
  return mix;
}

function compare(observation: ShadowObservation): ShadowComparisonMetrics {
  const legacy = observation.legacy.results.map((result) => result.canonicalGroupId);
  const onlineV2 = observation.onlineV2.results.map((result) => result.canonicalGroupId);
  const legacySet = new Set(legacy);
  const v2Set = new Set(onlineV2);
  const difference = [...new Set([
    ...legacy.filter((id) => !v2Set.has(id)),
    ...onlineV2.filter((id) => !legacySet.has(id)),
  ])].sort();
  let commonPrefixLength = 0;
  while (legacy[commonPrefixLength] !== undefined && legacy[commonPrefixLength] === onlineV2[commonPrefixLength]) {
    commonPrefixLength += 1;
  }
  const missingRequiredIndexes = observation.queryPlan.requiredIndexes
    .filter((index) => !observation.queryPlan.usedIndexes.includes(index));
  return {
    legacyEligibleCanonicalGroups: legacy,
    onlineV2EligibleCanonicalGroups: onlineV2,
    eligibleSetSymmetricDifference: difference,
    legacyRouteMix: routeMix(observation.legacy),
    onlineV2RouteMix: routeMix(observation.onlineV2),
    exactOrderMatch: legacy.length === onlineV2.length && legacy.every((id, index) => id === onlineV2[index]),
    commonPrefixLength,
    emptyReasonMatch: observation.legacy.emptyReason === observation.onlineV2.emptyReason,
    legacyLatencyMs: observation.legacyLatencyMs,
    onlineV2LatencyMs: observation.onlineV2LatencyMs,
    latencyDeltaMs: observation.onlineV2LatencyMs - observation.legacyLatencyMs,
    queryPlanReady: !observation.queryPlan.sequentialScan && missingRequiredIndexes.length === 0,
    missingRequiredIndexes,
  };
}

function selectorMatches(context: ShadowRequestContext, selectors: readonly RolloutSelector[]): boolean {
  return selectors.some((selector) => selector.cohort === context.cohort
    && selector.countryCode === context.countryCode
    && selector.roleFamilyId === context.roleFamilyId);
}

function supplyGateFailure(required: readonly string[], gates: readonly SupplyScorecardGate[], now: Date): string | null {
  for (const gateId of required) {
    const gate = gates.find((candidate) => candidate.gateId === gateId);
    if (!gate) return `SUPPLY_GATE_MISSING:${gateId}`;
    if (!Number.isFinite(Date.parse(gate.recordedAt)) || Date.parse(gate.expiresAt) <= now.getTime()) return `SUPPLY_GATE_EXPIRED:${gateId}`;
    if (gate.freshVisibleCanonicalGroups < gate.minimumRequired) return `SUPPLY_GATE_FAILED:${gateId}`;
    if (gateId === PARIS_FULLSTACK_SUPPLY_GATE
      && (gate.city !== "Paris" || gate.radiusKm !== 52 || gate.countryCode !== "FR" || gate.roleFamilyId !== "fullstack")) {
      return `SUPPLY_GATE_SCOPE_MISMATCH:${gateId}`;
    }
  }
  return null;
}

export function evaluateShadowCanary(
  controls: ShadowCanaryControls,
  context: ShadowRequestContext,
  observation: ShadowObservation,
  supplyGates: readonly SupplyScorecardGate[],
  now = new Date(),
): ShadowCanaryDecision {
  validateControls(controls);
  const isSampled = controls.shadowEnabled && sampled(context.candidateId, controls.sampleRateBasisPoints);
  if (!isSampled) {
    return {
      exposedResponse: observation.legacy,
      shadowExecuted: false,
      sampled: false,
      canaryAuthorized: false,
      rollbackReason: controls.rollbackRequested ? "ROLLBACK_REQUESTED" : "SHADOW_DISABLED_OR_NOT_SAMPLED",
      parityDigest: null,
      metrics: null,
    };
  }
  const metrics = compare(observation);
  const supplyFailure = supplyGateFailure(controls.requiredSupplyGates, supplyGates, now);
  const rollbackReason = controls.rollbackRequested ? "ROLLBACK_REQUESTED"
    : !selectorMatches(context, controls.selectors) ? "ROLLOUT_SCOPE_DENIED"
    : supplyFailure
      ?? (!metrics.queryPlanReady ? "QUERY_PLAN_GATE_FAILED" : null);
  return {
    // PR6 is observation-only: even an authorized canary never becomes the visible response here.
    exposedResponse: observation.legacy,
    shadowExecuted: true,
    sampled: true,
    canaryAuthorized: controls.canaryEnabled && rollbackReason === null,
    rollbackReason: controls.canaryEnabled ? rollbackReason : "CANARY_DISABLED",
    parityDigest: digestOnlineV2Domain(observation.onlineV2Domain),
    metrics,
  };
}
