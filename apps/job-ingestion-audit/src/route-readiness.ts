import { createHash } from "node:crypto";

export const routeFailureReasons = [
  "missing_url",
  "expired_or_unavailable",
  "account_or_login_required",
  "captcha_or_bot_wall",
  "aggregator_or_discovery_route",
  "unknown_ats",
  "known_ats_without_runtime_driver",
  "runtime_driver_route_unresolved",
  "unsupported_required_fields",
  "missing_user_input",
  "stale_validation",
  "direct_manual_only",
] as const;

export type RouteFailureReason = (typeof routeFailureReasons)[number];

export interface RouteReadinessAggregateInput {
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason?: string;
  sample: boolean;
  generatedAt: string;
  freshnessCutoff: string;
  queryVersion: string;
  layeredFrenchJobs: number;
  staticAutoApplicable: number;
  runtimeReadyAutoApplicable: number;
  actionableJobs: number;
  franceTravailRuntimeReady: number;
  topProviderRuntimeReady: number;
  failureBuckets: Record<RouteFailureReason, number>;
  paidUserCoverage: {
    evaluatedPaidUsers: number;
    exhaustedPaidUsers: number;
    p10: number;
    p50: number;
    p90: number;
  };
}

export interface RouteReadinessReport extends RouteReadinessAggregateInput {
  schemaVersion: "hirly.french-route-readiness.v1";
  status: "COMPLETE";
  autoApplicableRate: number;
  optimisticOverclaim: number;
  feedExhaustionRate: number;
  franceTravailRuntimeReadyShare: number;
  topProviderRuntimeReadyShare: number;
  digest: string;
}

export type OccurrenceAuthority =
  | "direct_employer"
  | "official_public"
  | "aggregator"
  | "unknown";

export type OccurrenceRoute =
  | "verified_runtime_ats"
  | "direct_ats"
  | "direct_company"
  | "manual_public"
  | "account_required"
  | "discovery_only"
  | "unknown";

export interface OccurrencePreferenceCandidate {
  groupKey: string;
  occurrenceKey: string;
  active: boolean;
  authority: OccurrenceAuthority;
  route: OccurrenceRoute;
  confidence: number;
  verifiedAt?: string;
}

export interface OccurrencePreferenceReport {
  schemaVersion: "hirly.occurrence-preference-dry-run.v1";
  groupsEvaluated: number;
  groupsWithSelection: number;
  selectionsChanged: number;
  currentVerifiedRuntimeSelections: number;
  verifiedRuntimeSelections: number;
  verifiedRuntimeSelectionUplift: number;
  currentDirectSelections: number;
  directSelections: number;
  directSelectionUplift: number;
  digest: string;
}

export const occurrencePreferenceRelations = [
  "job_occurrences",
  "canonical_job_groups",
  "canonical_job_group_members",
] as const;

export type OccurrencePreferenceRelation =
  (typeof occurrencePreferenceRelations)[number];

export interface OccurrencePreferenceStructuralBlockerInput {
  status: "BLOCKED_STRUCTURAL";
  generatedAt: string;
  schemaAuditVersion: string;
  missingRelations: OccurrencePreferenceRelation[];
  blockerReason: string;
}

export interface OccurrencePreferenceStructuralBlocker {
  schemaVersion: "hirly.occurrence-preference-structural-blocker.v1";
  status: "BLOCKED_STRUCTURAL";
  scoreable: false;
  generatedAt: string;
  schemaAuditVersion: string;
  missingRelations: OccurrencePreferenceRelation[];
  blockerReason: string;
  preferredDirectOccurrenceUplift: null;
  unlockCondition: string;
  safeguards: {
    readOnly: true;
    aggregateOnly: true;
    canonicalWrites: false;
    applicationSubmissions: false;
    sourceActivationChanges: false;
    writerTransfer: false;
  };
  digest: string;
}

export interface DiversificationSnapshot {
  runtimeReadyJobs: number;
  franceTravailRuntimeReadyJobs: number;
  topProviderRuntimeReadyJobs: number;
  evaluatedPaidUsers: number;
  exhaustedPaidUsers: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface SourceDiversificationGateInput {
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason?: string;
  sample: boolean;
  generatedAt: string;
  routeReadinessDigest: string;
  netNewMeasurementDigest: string;
  current: DiversificationSnapshot;
  projected: DiversificationSnapshot;
  proposedSources: Array<{
    sourceKey: string;
    incrementalRuntimeReadyJobs: number;
    affectedPaidUsers: number;
  }>;
  thresholds: {
    minRuntimeReadyUplift: number;
    maxFranceTravailShare: number;
    maxTopProviderShare: number;
    maxFeedExhaustionRate: number;
    minP10: number;
  };
}

export interface SourceDiversificationGateReport {
  schemaVersion: "hirly.source-diversification-gate.v1";
  status: "GO" | "NO_GO";
  generatedAt: string;
  current: DiversificationSnapshot & {
    franceTravailShare: number;
    topProviderShare: number;
    feedExhaustionRate: number;
  };
  projected: DiversificationSnapshot & {
    franceTravailShare: number;
    topProviderShare: number;
    feedExhaustionRate: number;
  };
  runtimeReadyUplift: number;
  franceTravailShareDelta: number;
  proposedSources: SourceDiversificationGateInput["proposedSources"];
  failedGates: string[];
  safeguards: {
    aggregateOnly: true;
    applicationSubmissions: false;
    sourceActivationChanges: false;
    canonicalWrites: false;
  };
  digest: string;
}

const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;

const fail = (message: string): never => {
  throw new Error(`ROUTE_READINESS_REFUSED: ${message}`);
};

function count(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function timestamp(value: string, path: string): string {
  if (!isoTimestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${path} must be an ISO timestamp with an explicit timezone`);
  }
  return new Date(value).toISOString();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(8));
}

export function buildRouteReadinessReport(
  input: RouteReadinessAggregateInput,
): RouteReadinessReport {
  if (input.status !== "COMPLETE") {
    fail(`status is not scoreable: ${input.blockerReason ?? "missing blocker reason"}`);
  }
  if (input.sample !== false) fail("sample evidence is not scoreable");
  const generatedAt = timestamp(input.generatedAt, "generatedAt");
  const freshnessCutoff = timestamp(input.freshnessCutoff, "freshnessCutoff");
  if (Date.parse(generatedAt) < Date.parse(freshnessCutoff)) {
    fail("generatedAt must not precede freshnessCutoff");
  }
  if (!/^g018-route-readiness-v\d+$/.test(input.queryVersion)) {
    fail("queryVersion is not recognized");
  }

  const layeredFrenchJobs = count(input.layeredFrenchJobs, "layeredFrenchJobs");
  const actionableJobs = count(input.actionableJobs, "actionableJobs");
  const staticAutoApplicable = count(
    input.staticAutoApplicable,
    "staticAutoApplicable",
  );
  const runtimeReadyAutoApplicable = count(
    input.runtimeReadyAutoApplicable,
    "runtimeReadyAutoApplicable",
  );
  const franceTravailRuntimeReady = count(
    input.franceTravailRuntimeReady,
    "franceTravailRuntimeReady",
  );
  const topProviderRuntimeReady = count(
    input.topProviderRuntimeReady,
    "topProviderRuntimeReady",
  );
  if (
    runtimeReadyAutoApplicable > staticAutoApplicable
    || staticAutoApplicable > actionableJobs
    || actionableJobs > layeredFrenchJobs
    || franceTravailRuntimeReady > runtimeReadyAutoApplicable
    || topProviderRuntimeReady > runtimeReadyAutoApplicable
  ) {
    fail("inventory counters violate strict-auto <= static-auto <= actionable <= inventory");
  }

  const failureBuckets = Object.fromEntries(
    routeFailureReasons.map((reason) => [
      reason,
      count(input.failureBuckets[reason], `failureBuckets.${reason}`),
    ]),
  ) as Record<RouteFailureReason, number>;
  const failureTotal = Object.values(failureBuckets).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (failureTotal + runtimeReadyAutoApplicable !== layeredFrenchJobs) {
    fail("failure buckets do not reconcile to layered French inventory");
  }

  const coverage = {
    evaluatedPaidUsers: count(
      input.paidUserCoverage.evaluatedPaidUsers,
      "paidUserCoverage.evaluatedPaidUsers",
    ),
    exhaustedPaidUsers: count(
      input.paidUserCoverage.exhaustedPaidUsers,
      "paidUserCoverage.exhaustedPaidUsers",
    ),
    p10: count(input.paidUserCoverage.p10, "paidUserCoverage.p10"),
    p50: count(input.paidUserCoverage.p50, "paidUserCoverage.p50"),
    p90: count(input.paidUserCoverage.p90, "paidUserCoverage.p90"),
  };
  if (
    coverage.exhaustedPaidUsers > coverage.evaluatedPaidUsers
    || coverage.p10 > coverage.p50
    || coverage.p50 > coverage.p90
  ) {
    fail("paid-user coverage counters are inconsistent");
  }

  const unsigned = {
    ...input,
    schemaVersion: "hirly.french-route-readiness.v1" as const,
    status: "COMPLETE" as const,
    generatedAt,
    freshnessCutoff,
    layeredFrenchJobs,
    actionableJobs,
    staticAutoApplicable,
    runtimeReadyAutoApplicable,
    franceTravailRuntimeReady,
    topProviderRuntimeReady,
    failureBuckets,
    paidUserCoverage: coverage,
    autoApplicableRate: rate(runtimeReadyAutoApplicable, layeredFrenchJobs),
    optimisticOverclaim: staticAutoApplicable - runtimeReadyAutoApplicable,
    feedExhaustionRate: rate(
      coverage.exhaustedPaidUsers,
      coverage.evaluatedPaidUsers,
    ),
    franceTravailRuntimeReadyShare: rate(
      franceTravailRuntimeReady,
      runtimeReadyAutoApplicable,
    ),
    topProviderRuntimeReadyShare: rate(
      topProviderRuntimeReady,
      runtimeReadyAutoApplicable,
    ),
  };
  return { ...unsigned, digest: digest(unsigned) };
}

const sha256Pattern = /^[a-f0-9]{64}$/;

function diversificationSnapshot(
  input: DiversificationSnapshot,
  path: string,
): DiversificationSnapshot {
  const snapshot = {
    runtimeReadyJobs: count(input.runtimeReadyJobs, `${path}.runtimeReadyJobs`),
    franceTravailRuntimeReadyJobs: count(
      input.franceTravailRuntimeReadyJobs,
      `${path}.franceTravailRuntimeReadyJobs`,
    ),
    topProviderRuntimeReadyJobs: count(
      input.topProviderRuntimeReadyJobs,
      `${path}.topProviderRuntimeReadyJobs`,
    ),
    evaluatedPaidUsers: count(
      input.evaluatedPaidUsers,
      `${path}.evaluatedPaidUsers`,
    ),
    exhaustedPaidUsers: count(
      input.exhaustedPaidUsers,
      `${path}.exhaustedPaidUsers`,
    ),
    p10: count(input.p10, `${path}.p10`),
    p50: count(input.p50, `${path}.p50`),
    p90: count(input.p90, `${path}.p90`),
  };
  if (
    snapshot.franceTravailRuntimeReadyJobs > snapshot.runtimeReadyJobs
    || snapshot.topProviderRuntimeReadyJobs > snapshot.runtimeReadyJobs
    || snapshot.exhaustedPaidUsers > snapshot.evaluatedPaidUsers
    || snapshot.p10 > snapshot.p50
    || snapshot.p50 > snapshot.p90
  ) {
    fail(`${path} counters are inconsistent`);
  }
  return snapshot;
}

export function buildSourceDiversificationGate(
  input: SourceDiversificationGateInput,
): SourceDiversificationGateReport {
  if (input.status !== "COMPLETE") {
    fail(`diversification status is not scoreable: ${input.blockerReason ?? "missing blocker reason"}`);
  }
  if (input.sample !== false) fail("diversification sample evidence is not scoreable");
  const generatedAt = timestamp(input.generatedAt, "generatedAt");
  if (
    !sha256Pattern.test(input.routeReadinessDigest)
    || !sha256Pattern.test(input.netNewMeasurementDigest)
  ) {
    fail("diversification evidence digests must be SHA-256 values");
  }
  const current = diversificationSnapshot(input.current, "current");
  const projected = diversificationSnapshot(input.projected, "projected");
  if (
    current.evaluatedPaidUsers === 0
    || projected.evaluatedPaidUsers !== current.evaluatedPaidUsers
  ) {
    fail("paid-user cohorts must be non-empty and identical");
  }
  if (
    projected.runtimeReadyJobs < current.runtimeReadyJobs
    || projected.franceTravailRuntimeReadyJobs > current.franceTravailRuntimeReadyJobs
  ) {
    fail("projected inventory cannot remove runtime-ready jobs or add France Travail jobs");
  }

  const sourceKeys = new Set<string>();
  const proposedSources = input.proposedSources
    .map((source, index) => {
      const sourceKey = source.sourceKey.trim().toLowerCase();
      if (!sourceKey || sourceKey === "france_travail" || sourceKeys.has(sourceKey)) {
        fail(`proposedSources[${index}].sourceKey must be unique and non-France-Travail`);
      }
      sourceKeys.add(sourceKey);
      const affectedPaidUsers = count(
        source.affectedPaidUsers,
        `proposedSources[${index}].affectedPaidUsers`,
      );
      if (affectedPaidUsers > current.evaluatedPaidUsers) {
        fail(`proposedSources[${index}].affectedPaidUsers exceeds the paid cohort`);
      }
      return {
        sourceKey,
        incrementalRuntimeReadyJobs: count(
          source.incrementalRuntimeReadyJobs,
          `proposedSources[${index}].incrementalRuntimeReadyJobs`,
        ),
        affectedPaidUsers,
      };
    })
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  if (proposedSources.length === 0) fail("proposedSources must not be empty");

  const runtimeReadyUplift = projected.runtimeReadyJobs - current.runtimeReadyJobs;
  const reconciledUplift = proposedSources.reduce(
    (sum, source) => sum + source.incrementalRuntimeReadyJobs,
    0,
  );
  if (reconciledUplift !== runtimeReadyUplift) {
    fail("proposed source uplift does not reconcile to projected inventory");
  }

  const threshold = {
    minRuntimeReadyUplift: count(
      input.thresholds.minRuntimeReadyUplift,
      "thresholds.minRuntimeReadyUplift",
    ),
    maxFranceTravailShare: input.thresholds.maxFranceTravailShare,
    maxTopProviderShare: input.thresholds.maxTopProviderShare,
    maxFeedExhaustionRate: input.thresholds.maxFeedExhaustionRate,
    minP10: count(input.thresholds.minP10, "thresholds.minP10"),
  };
  for (const [name, value] of Object.entries(threshold)) {
    if (name.startsWith("max") && (!Number.isFinite(value) || value < 0 || value > 1)) {
      fail(`thresholds.${name} must be between 0 and 1`);
    }
  }

  const currentMetrics = {
    ...current,
    franceTravailShare: rate(
      current.franceTravailRuntimeReadyJobs,
      current.runtimeReadyJobs,
    ),
    topProviderShare: rate(current.topProviderRuntimeReadyJobs, current.runtimeReadyJobs),
    feedExhaustionRate: rate(current.exhaustedPaidUsers, current.evaluatedPaidUsers),
  };
  const projectedMetrics = {
    ...projected,
    franceTravailShare: rate(
      projected.franceTravailRuntimeReadyJobs,
      projected.runtimeReadyJobs,
    ),
    topProviderShare: rate(projected.topProviderRuntimeReadyJobs, projected.runtimeReadyJobs),
    feedExhaustionRate: rate(projected.exhaustedPaidUsers, projected.evaluatedPaidUsers),
  };
  const failedGates: string[] = [];
  if (runtimeReadyUplift < threshold.minRuntimeReadyUplift) {
    failedGates.push("runtime_ready_uplift_below_minimum");
  }
  if (
    projectedMetrics.franceTravailShare >= currentMetrics.franceTravailShare
    || projectedMetrics.franceTravailShare > threshold.maxFranceTravailShare
  ) {
    failedGates.push("france_travail_concentration_not_reduced");
  }
  if (projectedMetrics.topProviderShare > threshold.maxTopProviderShare) {
    failedGates.push("top_provider_concentration_above_maximum");
  }
  if (projectedMetrics.feedExhaustionRate > threshold.maxFeedExhaustionRate) {
    failedGates.push("feed_exhaustion_above_maximum");
  }
  if (projected.p10 < threshold.minP10) {
    failedGates.push("paid_user_p10_below_minimum");
  }
  if (
    projected.exhaustedPaidUsers > current.exhaustedPaidUsers
    || projected.p10 < current.p10
    || projected.p50 < current.p50
    || projected.p90 < current.p90
  ) {
    failedGates.push("paid_user_coverage_regressed");
  }

  const unsigned = {
    schemaVersion: "hirly.source-diversification-gate.v1" as const,
    status: failedGates.length === 0 ? "GO" as const : "NO_GO" as const,
    generatedAt,
    current: currentMetrics,
    projected: projectedMetrics,
    runtimeReadyUplift,
    franceTravailShareDelta: Number(
      (projectedMetrics.franceTravailShare - currentMetrics.franceTravailShare).toFixed(8),
    ),
    proposedSources,
    failedGates,
    safeguards: {
      aggregateOnly: true as const,
      applicationSubmissions: false as const,
      sourceActivationChanges: false as const,
      canonicalWrites: false as const,
    },
  };
  return { ...unsigned, digest: digest(unsigned) };
}

const routeRank: Record<OccurrenceRoute, number> = {
  verified_runtime_ats: 700,
  direct_ats: 600,
  direct_company: 500,
  manual_public: 300,
  account_required: 200,
  discovery_only: 100,
  unknown: 0,
};

const authorityRank: Record<OccurrenceAuthority, number> = {
  direct_employer: 30,
  official_public: 20,
  aggregator: 10,
  unknown: 0,
};

function preferenceScore(candidate: OccurrencePreferenceCandidate): number {
  if (!candidate.active) return -1;
  if (
    !Number.isFinite(candidate.confidence)
    || candidate.confidence < 0
    || candidate.confidence > 1
  ) {
    fail("occurrence confidence must be between 0 and 1");
  }
  const verified = candidate.verifiedAt
    ? Date.parse(timestamp(candidate.verifiedAt, "occurrence.verifiedAt"))
    : 0;
  const recency = verified === 0 ? 0 : Math.floor(verified / 86_400_000) % 10_000;
  return (
    routeRank[candidate.route] * 1_000_000
    + authorityRank[candidate.authority] * 10_000
    + Math.round(candidate.confidence * 1_000) * 10
    + recency
  );
}

export function buildOccurrencePreferenceDryRun(
  candidates: OccurrencePreferenceCandidate[],
  currentSelections: Record<string, string | undefined> = {},
): OccurrencePreferenceReport {
  const groups = new Map<string, OccurrencePreferenceCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.groupKey.trim() || !candidate.occurrenceKey.trim()) {
      fail("occurrence groupKey and occurrenceKey are required");
    }
    const group = groups.get(candidate.groupKey) ?? [];
    if (group.some((item) => item.occurrenceKey === candidate.occurrenceKey)) {
      fail("duplicate occurrence identity in canonical group");
    }
    group.push(candidate);
    groups.set(candidate.groupKey, group);
  }

  let groupsWithSelection = 0;
  let selectionsChanged = 0;
  let currentVerifiedRuntimeSelections = 0;
  let verifiedRuntimeSelections = 0;
  let currentDirectSelections = 0;
  let directSelections = 0;
  const sealedSelections: Array<[string, string]> = [];
  for (const [groupKey, group] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right))) {
    const ranked = group
      .map((candidate) => ({ candidate, score: preferenceScore(candidate) }))
      .filter(({ score }) => score >= 0)
      .sort(
        (left, right) =>
          right.score - left.score
          || left.candidate.occurrenceKey.localeCompare(
            right.candidate.occurrenceKey,
          ),
      );
    const selected = ranked[0]?.candidate;
    if (!selected) continue;
    groupsWithSelection += 1;
    const current = group.find(
      (candidate) => candidate.occurrenceKey === currentSelections[groupKey]
        && candidate.active,
    );
    if (current?.route === "verified_runtime_ats") {
      currentVerifiedRuntimeSelections += 1;
    }
    if (
      current?.route === "verified_runtime_ats"
      || current?.route === "direct_ats"
      || current?.route === "direct_company"
    ) {
      currentDirectSelections += 1;
    }
    if (currentSelections[groupKey] !== selected.occurrenceKey) {
      selectionsChanged += 1;
    }
    if (selected.route === "verified_runtime_ats") {
      verifiedRuntimeSelections += 1;
    }
    if (
      selected.route === "verified_runtime_ats"
      || selected.route === "direct_ats"
      || selected.route === "direct_company"
    ) {
      directSelections += 1;
    }
    sealedSelections.push([groupKey, selected.occurrenceKey]);
  }
  const unsigned = {
    schemaVersion: "hirly.occurrence-preference-dry-run.v1" as const,
    groupsEvaluated: groups.size,
    groupsWithSelection,
    selectionsChanged,
    currentVerifiedRuntimeSelections,
    verifiedRuntimeSelections,
    verifiedRuntimeSelectionUplift:
      verifiedRuntimeSelections - currentVerifiedRuntimeSelections,
    currentDirectSelections,
    directSelections,
    directSelectionUplift: directSelections - currentDirectSelections,
  };
  return {
    ...unsigned,
    digest: digest({ ...unsigned, selections: sealedSelections }),
  };
}

export function buildOccurrencePreferenceStructuralBlocker(
  input: OccurrencePreferenceStructuralBlockerInput,
): OccurrencePreferenceStructuralBlocker {
  if (input.status !== "BLOCKED_STRUCTURAL") {
    fail("occurrence structural evidence must remain blocked");
  }
  const generatedAt = timestamp(input.generatedAt, "generatedAt");
  if (!/^g018-occurrence-schema-audit-v\d+$/.test(input.schemaAuditVersion)) {
    fail("occurrence schemaAuditVersion is not recognized");
  }
  const blockerReason = input.blockerReason.trim();
  if (!blockerReason) fail("occurrence blockerReason is required");

  const relationSet = new Set(input.missingRelations);
  if (relationSet.size !== input.missingRelations.length) {
    fail("occurrence missingRelations must be unique");
  }
  const missingRelations = occurrencePreferenceRelations.filter((relation) =>
    relationSet.has(relation));
  if (missingRelations.length === 0) {
    fail("occurrence evidence requires at least one missing relation");
  }
  if (missingRelations.length !== relationSet.size) {
    fail("occurrence evidence contains an unrecognized relation");
  }

  const unsigned = {
    schemaVersion: "hirly.occurrence-preference-structural-blocker.v1" as const,
    status: "BLOCKED_STRUCTURAL" as const,
    scoreable: false as const,
    generatedAt,
    schemaAuditVersion: input.schemaAuditVersion,
    missingRelations,
    blockerReason,
    preferredDirectOccurrenceUplift: null,
    unlockCondition:
      "Apply an approved backward-compatible occurrence schema, populate source occurrences through the single-writer ingestion boundary, then rerun the aggregate read-only preference census.",
    safeguards: {
      readOnly: true as const,
      aggregateOnly: true as const,
      canonicalWrites: false as const,
      applicationSubmissions: false as const,
      sourceActivationChanges: false as const,
      writerTransfer: false as const,
    },
  };
  return { ...unsigned, digest: digest(unsigned) };
}
