import { createHash } from "node:crypto";
import { onlineMatchResponseSchema, type OnlineMatchResponse } from "@hirly/contracts";
import {
  DISABLED_SHADOW_CANARY_CONTROLS,
  evaluateShadowCanary,
  type OnlineV2DomainRecord,
  type QueryPlanObservation,
  type ShadowCanaryControls,
  type ShadowRequestContext,
  type SupplyScorecardGate,
} from "@hirly/matching-oracle";

export const SHADOW_CANARY_EVIDENCE_VERSION = "hirly.matching-shadow-canary.v1" as const;

export type InjectedBreach = "none" | "parity" | "latency" | "supply" | "error";

export interface FrozenShadowCanaryInput {
  schemaVersion: typeof SHADOW_CANARY_EVIDENCE_VERSION;
  exerciseId: string;
  observedAt: string;
  context: ShadowRequestContext;
  controls: ShadowCanaryControls;
  thresholds: {
    minimumEligibleSetParity: number;
    maximumLatencyDeltaMs: number;
    minimumFreshVisibleCanonicalGroups: number;
    maximumErrorRate: number;
  };
  legacy: OnlineMatchResponse;
  onlineV2: OnlineMatchResponse;
  onlineV2Domain: readonly OnlineV2DomainRecord[];
  legacyLatencyMs: number;
  onlineV2LatencyMs: number;
  requestCount: number;
  legacyErrorCount: number;
  onlineV2ErrorCount: number;
  queryPlan: QueryPlanObservation;
  supplyGates: readonly SupplyScorecardGate[];
}

export interface LegacyResponsePort {
  exposeLegacy(response: OnlineMatchResponse): void;
}

export interface ShadowCanaryEvidence {
  schemaVersion: typeof SHADOW_CANARY_EVIDENCE_VERSION;
  exerciseId: string;
  observedAt: string;
  rolloutDefault: "disabled";
  executionMode: "disabled" | "frozen-shadow";
  injectedBreach: InjectedBreach;
  scope: {
    cohort: string;
    countryCode: string;
    roleFamilyId: string;
    city: string | null;
    radiusKm: number | null;
  };
  stages: readonly {
    stage: "rollout" | "cohort" | "country" | "role" | "supply" | "parity" | "latency" | "error";
    passed: boolean;
    observed: string | number | boolean;
    required: string | number | boolean;
  }[];
  metrics: {
    eligibleSetParity: number;
    latencyDeltaMs: number;
    freshVisibleCanonicalGroups: number;
    legacyErrorRate: number;
    onlineV2ErrorRate: number;
    queryPlanReady: boolean;
    parityDigest: string | null;
  };
  decision: {
    shadowExecuted: boolean;
    canaryAuthorizedBeforeThresholds: boolean;
    canaryAuthorized: false;
    automaticRollback: boolean;
    rollbackReason: string;
  };
  sideEffects: {
    visibleLegacyResponses: 1;
    visibleOnlineV2Responses: 0;
    canonicalWrites: 0;
    jobWrites: 0;
    providerWrites: 0;
    taskEnqueues: 0;
  };
  evidenceDigest: string;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(6));
}

function parityRatio(legacy: OnlineMatchResponse, onlineV2: OnlineMatchResponse): number {
  const legacyIds = new Set(legacy.results.map((result) => result.canonicalGroupId));
  const v2Ids = new Set(onlineV2.results.map((result) => result.canonicalGroupId));
  const union = new Set([...legacyIds, ...v2Ids]);
  if (union.size === 0) return 1;
  const intersection = [...legacyIds].filter((id) => v2Ids.has(id)).length;
  return Number((intersection / union.size).toFixed(6));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertFrozenInput(input: FrozenShadowCanaryInput): void {
  if (input.schemaVersion !== SHADOW_CANARY_EVIDENCE_VERSION) throw new Error("unsupported shadow canary schema");
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("observedAt must be an ISO timestamp");
  if (!Number.isSafeInteger(input.requestCount) || input.requestCount <= 0) throw new Error("requestCount must be positive");
  for (const count of [input.legacyErrorCount, input.onlineV2ErrorCount]) {
    if (!Number.isSafeInteger(count) || count < 0 || count > input.requestCount) throw new Error("error counts must be within requestCount");
  }
  for (const value of [input.thresholds.minimumEligibleSetParity, input.thresholds.maximumErrorRate]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("rate thresholds must be between zero and one");
  }
  if (!Number.isFinite(input.thresholds.maximumLatencyDeltaMs) || input.thresholds.maximumLatencyDeltaMs < 0) {
    throw new Error("maximumLatencyDeltaMs must be non-negative");
  }
  if (!Number.isSafeInteger(input.thresholds.minimumFreshVisibleCanonicalGroups)
    || input.thresholds.minimumFreshVisibleCanonicalGroups < 0) {
    throw new Error("minimumFreshVisibleCanonicalGroups must be a non-negative integer");
  }
  onlineMatchResponseSchema.parse(input.legacy);
  onlineMatchResponseSchema.parse(input.onlineV2);
}

function applyBreach(input: FrozenShadowCanaryInput, breach: InjectedBreach) {
  const onlineV2 = breach === "parity" ? { ...input.onlineV2, results: [], eligibleCount: 0 } : input.onlineV2;
  const onlineV2Domain = breach === "parity" ? [] : input.onlineV2Domain;
  const onlineV2LatencyMs = breach === "latency"
    ? input.legacyLatencyMs + input.thresholds.maximumLatencyDeltaMs + 1
    : input.onlineV2LatencyMs;
  const onlineV2ErrorCount = breach === "error" ? input.requestCount : input.onlineV2ErrorCount;
  const supplyGates = breach === "supply"
    ? input.supplyGates.map((gate) => ({ ...gate, freshVisibleCanonicalGroups: Math.max(0, input.thresholds.minimumFreshVisibleCanonicalGroups - 1) }))
    : input.supplyGates;
  return { onlineV2, onlineV2Domain, onlineV2LatencyMs, onlineV2ErrorCount, supplyGates };
}

export function executeFrozenShadowCanary(
  input: FrozenShadowCanaryInput,
  port: LegacyResponsePort,
  options: { execute?: boolean; injectedBreach?: InjectedBreach } = {},
): ShadowCanaryEvidence {
  assertFrozenInput(input);
  const executionEnabled = options.execute === true;
  const injectedBreach = options.injectedBreach ?? "none";
  const injected = applyBreach(input, injectedBreach);
  const controls = executionEnabled ? input.controls : DISABLED_SHADOW_CANARY_CONTROLS;
  const observation = {
    legacy: input.legacy,
    onlineV2: injected.onlineV2,
    onlineV2Domain: injected.onlineV2Domain,
    legacyLatencyMs: input.legacyLatencyMs,
    onlineV2LatencyMs: injected.onlineV2LatencyMs,
    queryPlan: input.queryPlan,
  };
  const base = evaluateShadowCanary(controls, input.context, observation, injected.supplyGates, new Date(input.observedAt));
  const baseline = evaluateShadowCanary(controls, input.context, {
    legacy: input.legacy,
    onlineV2: input.onlineV2,
    onlineV2Domain: input.onlineV2Domain,
    legacyLatencyMs: input.legacyLatencyMs,
    onlineV2LatencyMs: input.onlineV2LatencyMs,
    queryPlan: input.queryPlan,
  }, input.supplyGates, new Date(input.observedAt));
  port.exposeLegacy(input.legacy);

  const selector = input.controls.selectors.find((candidate) => candidate.cohort === input.context.cohort
    && candidate.countryCode === input.context.countryCode
    && candidate.roleFamilyId === input.context.roleFamilyId);
  const supply = injected.supplyGates.find((gate) => input.controls.requiredSupplyGates.includes(gate.gateId));
  const eligibleSetParity = parityRatio(input.legacy, injected.onlineV2);
  const latencyDeltaMs = injected.onlineV2LatencyMs - input.legacyLatencyMs;
  const legacyErrorRate = rate(input.legacyErrorCount, input.requestCount);
  const onlineV2ErrorRate = rate(injected.onlineV2ErrorCount, input.requestCount);
  const stages: ShadowCanaryEvidence["stages"] = [
    { stage: "rollout", passed: executionEnabled, observed: executionEnabled, required: true },
    { stage: "cohort", passed: Boolean(selector), observed: input.context.cohort, required: input.controls.selectors[0]?.cohort ?? "none" },
    { stage: "country", passed: Boolean(selector), observed: input.context.countryCode, required: input.controls.selectors[0]?.countryCode ?? "none" },
    { stage: "role", passed: Boolean(selector), observed: input.context.roleFamilyId, required: input.controls.selectors[0]?.roleFamilyId ?? "none" },
    { stage: "supply", passed: Boolean(supply && supply.freshVisibleCanonicalGroups >= input.thresholds.minimumFreshVisibleCanonicalGroups), observed: supply?.freshVisibleCanonicalGroups ?? 0, required: input.thresholds.minimumFreshVisibleCanonicalGroups },
    { stage: "parity", passed: eligibleSetParity >= input.thresholds.minimumEligibleSetParity, observed: eligibleSetParity, required: input.thresholds.minimumEligibleSetParity },
    { stage: "latency", passed: latencyDeltaMs <= input.thresholds.maximumLatencyDeltaMs, observed: latencyDeltaMs, required: input.thresholds.maximumLatencyDeltaMs },
    { stage: "error", passed: onlineV2ErrorRate <= input.thresholds.maximumErrorRate, observed: onlineV2ErrorRate, required: input.thresholds.maximumErrorRate },
  ];
  const firstFailed = stages.find((stage) => !stage.passed);
  const thresholdFailure = firstFailed ? `${firstFailed.stage.toUpperCase()}_THRESHOLD_BREACH` : null;
  const rollbackReason = base.rollbackReason ?? thresholdFailure ?? "OBSERVATION_ONLY";
  const automaticRollback = baseline.canaryAuthorized && (base.rollbackReason !== null || thresholdFailure !== null);
  const evidenceWithoutDigest = {
    schemaVersion: SHADOW_CANARY_EVIDENCE_VERSION,
    exerciseId: input.exerciseId,
    observedAt: new Date(input.observedAt).toISOString(),
    rolloutDefault: "disabled" as const,
    executionMode: executionEnabled ? "frozen-shadow" as const : "disabled" as const,
    injectedBreach,
    scope: {
      cohort: input.context.cohort,
      countryCode: input.context.countryCode,
      roleFamilyId: input.context.roleFamilyId,
      city: supply?.city ?? null,
      radiusKm: supply?.radiusKm ?? null,
    },
    stages,
    metrics: {
      eligibleSetParity,
      latencyDeltaMs,
      freshVisibleCanonicalGroups: supply?.freshVisibleCanonicalGroups ?? 0,
      legacyErrorRate,
      onlineV2ErrorRate,
      queryPlanReady: base.metrics?.queryPlanReady ?? false,
      parityDigest: base.parityDigest?.digest ?? null,
    },
    decision: {
      shadowExecuted: base.shadowExecuted,
      canaryAuthorizedBeforeThresholds: baseline.canaryAuthorized,
      canaryAuthorized: false as const,
      automaticRollback,
      rollbackReason,
    },
    sideEffects: {
      visibleLegacyResponses: 1 as const,
      visibleOnlineV2Responses: 0 as const,
      canonicalWrites: 0 as const,
      jobWrites: 0 as const,
      providerWrites: 0 as const,
      taskEnqueues: 0 as const,
    },
  };
  return { ...evidenceWithoutDigest, evidenceDigest: sha256(evidenceWithoutDigest) };
}
