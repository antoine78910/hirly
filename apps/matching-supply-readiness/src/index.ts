import { createHash } from "node:crypto";

export const PARIS_FULLSTACK_SCOPE = Object.freeze({
  countryCode: "FR",
  cohortId: "paris-52km",
  roleFamilyId: "fullstack-engineering",
  radiusKm: 52,
  centerLatitude: 48.8566,
  centerLongitude: 2.3522,
});

export const REQUIRED_INDEXES = Object.freeze([
  "candidate_search_profiles_active_country_role_idx",
  "job_search_documents_features_idx",
  "candidate_action_projection_exclusion_idx",
]);

export interface ReadinessScope {
  countryCode: string;
  cohortId: string;
  roleFamilyId: string;
  radiusKm: number;
  centerLatitude: number;
  centerLongitude: number;
}

export interface ReadinessThresholds {
  thresholdId: string;
  approvedBy: string;
  expiresAt: string;
  minimumFreshVisibleCanonicalGroups: number;
  maximumBlockedRate: number;
  maximumInvalidRate: number;
  maximumDuplicateRate: number;
  maximumActionExclusionRate: number;
  maximumProjectionLagSeconds: number;
}

export interface ReadinessException {
  exceptionId: string;
  approvedBy: string;
  expiresAt: string;
  minimumFreshVisibleCanonicalGroups: number;
  reason: string;
}

export interface ReadinessManifest {
  schemaVersion: "hirly.matching-supply-readiness.v1";
  evaluatedAt: string;
  freshnessCutoff: string;
  scope: ReadinessScope;
  thresholds: ReadinessThresholds;
  exception?: ReadinessException | null;
}

export interface ReadinessRow {
  canonical_group_id: string;
  lifecycle_status: string;
  validation_status: string;
  fulfillment_route: "auto" | "assisted" | "manual" | "blocked";
  source_eligible: boolean;
  policy_eligible: boolean;
  last_seen_at: string;
  projected_at: string;
  duplicate_count: number | string;
  action_excluded: boolean;
  scoped_candidate_count: number | string;
  latest_profile_projected_at: string | null;
}

export interface QueryPlanEvidence {
  captured: boolean;
  availableIndexes: readonly string[];
  plan: unknown;
}

export interface ReadinessScorecard {
  schemaVersion: "hirly.matching-supply-readiness.v1";
  decision: "enabled" | "disabled";
  decisionMode: "threshold" | "exception" | "blocked";
  scope: ReadinessScope;
  evaluatedAt: string;
  freshnessCutoff: string;
  thresholds: ReadinessThresholds;
  appliedMinimumFreshVisibleCanonicalGroups: number;
  counts: {
    scopedCandidates: number;
    canonicalGroups: number;
    freshVisibleCanonicalGroups: number;
    blocked: number;
    invalid: number;
    duplicates: number;
    actionExcluded: number;
    visibleByRoute: Record<"auto" | "assisted" | "manual" | "blocked", number>;
  };
  rates: {
    blocked: number;
    invalid: number;
    duplicate: number;
    actionExclusion: number;
  };
  projectionLagSeconds: number | null;
  evidence: {
    readOnlyTransaction: true;
    requiredIndexes: readonly string[];
    availableIndexes: readonly string[];
    missingIndexes: string[];
    queryPlanCaptured: boolean;
    queryPlanUsesRequiredIndex: boolean;
    complete: boolean;
  };
  exception: ReadinessException | null;
  failedGates: string[];
  rollbackReason: string;
  digest: string;
}

export const READINESS_SQL = `
WITH scoped_candidates AS (
  SELECT candidate_id, projected_at
  FROM public.candidate_search_profiles
  WHERE status = 'active'
    AND $1::text = ANY(country_codes)
    AND $2::text = ANY(role_family_ids)
    AND radius_km = $3::double precision
), scoped_documents AS (
  SELECT document.*,
    6371 * 2 * asin(sqrt(
      power(sin(radians(document.latitude - $4::double precision) / 2), 2)
      + cos(radians($4::double precision)) * cos(radians(document.latitude))
      * power(sin(radians(document.longitude - $5::double precision) / 2), 2)
    )) AS distance_km
  FROM public.job_search_documents AS document
  WHERE $1::text = ANY(document.country_codes)
    AND $2::text = ANY(document.role_family_codes)
    AND document.latitude IS NOT NULL
    AND document.longitude IS NOT NULL
)
SELECT
  document.canonical_group_id::text,
  document.lifecycle_status,
  document.validation_status,
  document.fulfillment_route,
  document.source_eligible,
  document.policy_eligible,
  document.last_seen_at,
  document.projected_at,
  count(*) OVER (PARTITION BY document.canonical_group_id)::integer AS duplicate_count,
  EXISTS (
    SELECT 1
    FROM public.candidate_action_projection AS action
    JOIN scoped_candidates AS candidate ON candidate.candidate_id = action.candidate_id
    WHERE action.retention_state = 'active'
      AND action.action_kind <> 'undo'
      AND (
        action.canonical_group_id = document.canonical_group_id
        OR document.canonical_group_id = ANY(action.canonical_group_aliases)
      )
  ) AS action_excluded,
  (SELECT count(*)::integer FROM scoped_candidates) AS scoped_candidate_count,
  (SELECT max(projected_at) FROM scoped_candidates) AS latest_profile_projected_at
FROM scoped_documents AS document
WHERE document.distance_km <= $3::double precision
ORDER BY document.canonical_group_id ASC
`.trim();

export const INDEX_EVIDENCE_SQL = `
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = ANY($1::text[])
ORDER BY indexname ASC
`.trim();

const MUTATING_SQL = /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call)\b/i;

export function assertReadOnlySql(sql: string): void {
  const normalized = sql.replace(/--.*$/gm, "").trim();
  if (!/^(with|select)\b/i.test(normalized) || MUTATING_SQL.test(normalized)) {
    throw new Error("matching readiness accepts read-only SELECT/CTE SQL only");
  }
  for (const forbidden of ["provider_registry", "projection_reconciliation_tasks", "worker_tasks"]) {
    if (normalized.includes(forbidden)) throw new Error(`matching readiness SQL references forbidden surface ${forbidden}`);
  }
}

function iso(value: string, path: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${path} must be an ISO timestamp with timezone`);
  }
  return new Date(parsed).toISOString();
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function normalizedManifest(input: ReadinessManifest): ReadinessManifest {
  if (input.schemaVersion !== "hirly.matching-supply-readiness.v1") throw new Error("unsupported schemaVersion");
  const scope = {
    ...input.scope,
    countryCode: input.scope.countryCode.trim().toUpperCase(),
    cohortId: input.scope.cohortId.trim().toLowerCase(),
    roleFamilyId: input.scope.roleFamilyId.trim().toLowerCase(),
  };
  if (!/^[A-Z]{2}$/.test(scope.countryCode)) throw new Error("scope.countryCode must be ISO alpha-2");
  if (!input.thresholds.thresholdId.trim() || !input.thresholds.approvedBy.trim()) {
    throw new Error("thresholds require thresholdId and approvedBy");
  }
  for (const key of [
    "minimumFreshVisibleCanonicalGroups", "maximumProjectionLagSeconds",
  ] as const) {
    const value = input.thresholds[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`thresholds.${key} must be a non-negative integer`);
  }
  for (const key of [
    "maximumBlockedRate", "maximumInvalidRate", "maximumDuplicateRate", "maximumActionExclusionRate",
  ] as const) {
    const value = input.thresholds[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`thresholds.${key} must be between zero and one`);
  }
  return { ...input, scope, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt"), freshnessCutoff: iso(input.freshnessCutoff, "freshnessCutoff") };
}

function planText(plan: unknown): string {
  return JSON.stringify(plan).toLowerCase();
}

export function buildReadinessScorecard(
  rawManifest: ReadinessManifest,
  rows: readonly ReadinessRow[],
  queryEvidence: QueryPlanEvidence,
): ReadinessScorecard {
  const manifest = normalizedManifest(rawManifest);
  const evaluatedAtMs = Date.parse(manifest.evaluatedAt);
  const freshnessCutoffMs = Date.parse(manifest.freshnessCutoff);
  const ids = new Set(rows.map((row) => row.canonical_group_id));
  const canonicalGroups = ids.size;
  const blockedIds = new Set(rows.filter((row) => row.fulfillment_route === "blocked" || row.lifecycle_status === "blocked").map((row) => row.canonical_group_id));
  const invalidIds = new Set(rows.filter((row) => row.validation_status === "invalid").map((row) => row.canonical_group_id));
  const duplicateIds = new Set(rows.filter((row) => Number(row.duplicate_count) > 1).map((row) => row.canonical_group_id));
  const actionExcludedIds = new Set(rows.filter((row) => row.action_excluded).map((row) => row.canonical_group_id));
  const visibleRows = rows.filter((row) =>
    row.lifecycle_status === "active"
    && row.validation_status === "valid"
    && row.source_eligible
    && row.policy_eligible
    && row.fulfillment_route !== "blocked"
    && Date.parse(row.last_seen_at) >= freshnessCutoffMs
    && !row.action_excluded
  );
  const visibleIds = new Set(visibleRows.map((row) => row.canonical_group_id));
  const visibleByRoute = { auto: 0, assisted: 0, manual: 0, blocked: 0 };
  for (const row of visibleRows) visibleByRoute[row.fulfillment_route] += 1;

  const projectedTimes = rows.flatMap((row) => [row.projected_at, row.latest_profile_projected_at].filter((value): value is string => Boolean(value))).map(Date.parse).filter(Number.isFinite);
  const latestProjection = projectedTimes.length === 0 ? null : Math.max(...projectedTimes);
  const projectionLagSeconds = latestProjection === null ? null : Math.max(0, Math.floor((evaluatedAtMs - latestProjection) / 1000));
  const availableIndexes = [...new Set(queryEvidence.availableIndexes)].sort();
  const missingIndexes = REQUIRED_INDEXES.filter((index) => !availableIndexes.includes(index));
  const queryPlanUsesRequiredIndex = REQUIRED_INDEXES.some((index) => planText(queryEvidence.plan).includes(index.toLowerCase()));
  const evidenceComplete = queryEvidence.captured && missingIndexes.length === 0 && queryPlanUsesRequiredIndex && rows.length > 0;

  const exception = manifest.exception ?? null;
  const thresholdActive = Date.parse(iso(manifest.thresholds.expiresAt, "thresholds.expiresAt")) > evaluatedAtMs;
  const exceptionActive = exception !== null
    && Boolean(exception.exceptionId.trim() && exception.approvedBy.trim() && exception.reason.trim())
    && Date.parse(iso(exception.expiresAt, "exception.expiresAt")) > evaluatedAtMs;
  const appliedMinimum = exceptionActive ? exception!.minimumFreshVisibleCanonicalGroups : manifest.thresholds.minimumFreshVisibleCanonicalGroups;
  const rates = {
    blocked: rate(blockedIds.size, canonicalGroups),
    invalid: rate(invalidIds.size, canonicalGroups),
    duplicate: rate(duplicateIds.size, canonicalGroups),
    actionExclusion: rate(actionExcludedIds.size, canonicalGroups),
  };
  const failedGates: string[] = [];
  if (!thresholdActive) failedGates.push("THRESHOLD_EXPIRED");
  if (!evidenceComplete) failedGates.push("INCOMPLETE_QUERY_EVIDENCE");
  if (visibleIds.size < appliedMinimum) failedGates.push("INSUFFICIENT_FRESH_VISIBLE_GROUPS");
  if (rates.blocked > manifest.thresholds.maximumBlockedRate) failedGates.push("BLOCKED_RATE_EXCEEDED");
  if (rates.invalid > manifest.thresholds.maximumInvalidRate) failedGates.push("INVALID_RATE_EXCEEDED");
  if (rates.duplicate > manifest.thresholds.maximumDuplicateRate) failedGates.push("DUPLICATE_RATE_EXCEEDED");
  if (rates.actionExclusion > manifest.thresholds.maximumActionExclusionRate) failedGates.push("ACTION_EXCLUSION_RATE_EXCEEDED");
  if (projectionLagSeconds === null || projectionLagSeconds > manifest.thresholds.maximumProjectionLagSeconds) failedGates.push("PROJECTION_LAG_EXCEEDED");
  if (exception && !exceptionActive) failedGates.push("EXCEPTION_EXPIRED_OR_INVALID");

  const decision: ReadinessScorecard["decision"] = failedGates.length === 0 ? "enabled" : "disabled";
  const scorecardWithoutDigest = {
    schemaVersion: "hirly.matching-supply-readiness.v1" as const,
    decision,
    decisionMode: decision === "disabled" ? "blocked" as const : exceptionActive ? "exception" as const : "threshold" as const,
    scope: manifest.scope,
    evaluatedAt: manifest.evaluatedAt,
    freshnessCutoff: manifest.freshnessCutoff,
    thresholds: manifest.thresholds,
    appliedMinimumFreshVisibleCanonicalGroups: appliedMinimum,
    counts: {
      scopedCandidates: rows.length === 0 ? 0 : Number(rows[0]!.scoped_candidate_count),
      canonicalGroups,
      freshVisibleCanonicalGroups: visibleIds.size,
      blocked: blockedIds.size,
      invalid: invalidIds.size,
      duplicates: duplicateIds.size,
      actionExcluded: actionExcludedIds.size,
      visibleByRoute,
    },
    rates,
    projectionLagSeconds,
    evidence: {
      readOnlyTransaction: true as const,
      requiredIndexes: REQUIRED_INDEXES,
      availableIndexes,
      missingIndexes,
      queryPlanCaptured: queryEvidence.captured,
      queryPlanUsesRequiredIndex,
      complete: evidenceComplete,
    },
    exception: exceptionActive ? exception : null,
    failedGates,
    rollbackReason: decision === "enabled" ? "NONE" : failedGates[0] ?? "UNKNOWN_READINESS_FAILURE",
  };
  const digest = createHash("sha256").update(JSON.stringify(scorecardWithoutDigest)).digest("hex");
  return { ...scorecardWithoutDigest, digest };
}
