import { createHash } from "node:crypto";

export type TerminalStatus = "PASS" | "FAIL" | "BLOCKED_EXTERNAL";

export interface AuditRow {
  riskId: string;
  suspectedFailure: string;
  affectedPath: string;
  references: string[];
  reproductionCommand: string;
  expected: unknown;
  actual: unknown;
  baseline: Record<string, unknown>;
  rootCause: string | null;
  status: TerminalStatus;
  proposedFix: string | null;
  regressionTest: string;
  finalEvidence: string;
  blocker?: {
    dependency: string;
    capabilityCheck: string;
    unblockProcedure: string;
  };
}

export interface PartitionFact {
  id: string;
  status: "completed_with_results" | "completed_zero_results" | "failed" | "blocked" | "never_run";
  expectedExternalIds: string[];
  fetchedExternalIds: string[];
  sourceTotal: number | null;
  cap: number | null;
  cursorHistory: string[];
  expectedFailures?: string[];
  pageBase?: 0 | 1;
  configuredPageBase?: 0 | 1;
  termination?:
    | "partial_page"
    | "empty_first_page"
    | "empty_intermediate_page"
    | "source_total"
    | "cap"
    | "failure";
  failure?: "rate_limit" | "transient_network" | "permanent_page";
  retryCount?: number;
  recoveredAfterRetry?: boolean;
  boundaryOperator?: "<" | "<=";
  expectedBoundaryOperator?: "<" | "<=";
  uniqueSortTieBreaker?: boolean;
  mutationDuringPagination?: "none" | "insert" | "delete";
  mutationHandled?: boolean;
}

export interface Funnel {
  rawReceived: number;
  normalized: number;
  rejectedNormalization: number;
  acceptedAfterFilters: number;
  rejectedByReason: Record<string, number>;
  newIdentity: number;
  existingIdentity: number;
  duplicateOccurrence: number;
  fuzzyCandidateOnly: number;
}

export interface CoverageManifest {
  dimensions: Record<"provider" | "contractType" | "geography" | "occupation", string[]>;
  terminalRules: Array<{
    providers: string[];
    state: "completed_with_results" | "completed_zero_results" | "failed" | "blocked";
    dependency: string;
    capabilityCheck: string;
    unblockProcedure: string;
  }>;
}

export interface CoverageRecord {
  partitionId: string;
  provider: string;
  contractType: string;
  geography: string;
  occupation: string;
  status: "completed_with_results" | "completed_zero_results" | "failed" | "blocked";
  blocker: null | {
    dependency: string;
    capabilityCheck: string;
    unblockProcedure: string;
  };
}

export interface MaterializedCoverage {
  schemaVersion: 3;
  records: CoverageRecord[];
}

export interface PaidUserInventorySnapshot {
  userHash: string;
  relevantTotal: number;
  uniqueTotal: number;
  actionableTotal: number;
  unseenActionableTotal: number;
  routeKnownTotal: number;
  directEmployerTotal: number;
  terminalReason: string;
}

export interface PaidUserCoverageBaseline {
  cohortSize: number;
  p10: number | null;
  median: number | null;
  p90: number | null;
  feedExhaustionRate: number | null;
  routeKnownRate: number | null;
  directEmployerRate: number | null;
  terminalReasonCounts: Record<string, number>;
}

export interface FranceTravailCensusPartition {
  id: string;
  publishedAfter: string;
  publishedBefore: string;
  parameters: Record<string, string>;
}

export interface FranceTravailCensusManifestInput {
  schemaVersion: 1;
  manifestVersion: string;
  paidCohortSnapshotAt: string;
  paidCohortSnapshotHash: string;
  profileStrata: Array<Record<string, unknown>>;
  samplingSeed: string;
  capRules: {
    pageSize: number;
    maxRecordsPerPartition: number;
    maxRetries: number;
  };
  publicationWindowRules: {
    boundary: "half-open";
    timezone: "UTC";
  };
  partitions: FranceTravailCensusPartition[];
}

export interface FranceTravailCensusManifest extends FranceTravailCensusManifestInput {
  manifestDigest: string;
}

export interface FranceTravailPartitionAccounting {
  partitionId: string;
  status: "complete" | "capped" | "blocked" | "failed";
  sourceReportedTotal: number | null;
  httpRecords: number;
  uniqueExternalIds: number;
  duplicateRawRecords: number;
  normalized: number;
  rejectedNormalization: number;
  occurrenceInserted: number;
  occurrenceUpdated: number;
  occurrenceDeduplicated: number;
  writeFailed: number;
  active: number;
  actionable: number;
  relevant: number;
  namedResiduals: Record<string, number>;
  blockerReason?: string;
}

const SENSITIVE_DIMENSION_KEY =
  /(?:^|_)(?:user|email|name|cv|resume|application|phone|address|search|keyword|raw)(?:_|$)/i;
const EMAIL_LIKE_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAggregateDimensions(value: unknown, path = "dimensions"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => validateAggregateDimensions(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && (value.length > 128 || EMAIL_LIKE_VALUE.test(value))) {
      return [`${path}:sensitive_or_unbounded_value`];
    }
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    if (SENSITIVE_DIMENSION_KEY.test(key)) return [`${path}.${key}:sensitive_key`];
    return validateAggregateDimensions(nested, `${path}.${key}`);
  });
}

export function redactAggregateDimensions(value: Record<string, unknown>): Record<string, unknown> {
  const redact = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(redact);
    if (!input || typeof input !== "object") {
      if (typeof input === "string" && (input.length > 128 || EMAIL_LIKE_VALUE.test(input)))
        return "[REDACTED]";
      return input;
    }
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_DIMENSION_KEY.test(key))
        .map(([key, nested]) => [key, redact(nested)]),
    );
  };
  return redact(value) as Record<string, unknown>;
}

export function stableDigest(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

export function computePaidUserCoverageBaseline(
  snapshots: PaidUserInventorySnapshot[],
): PaidUserCoverageBaseline {
  for (const snapshot of snapshots) {
    if (!/^[0-9a-f]{64}$/.test(snapshot.userHash)) {
      throw new Error("paid-user snapshot userHash must be a lowercase SHA-256 digest");
    }
    const counters = [
      snapshot.relevantTotal,
      snapshot.uniqueTotal,
      snapshot.actionableTotal,
      snapshot.unseenActionableTotal,
      snapshot.routeKnownTotal,
      snapshot.directEmployerTotal,
    ];
    if (counters.some((counter) => !Number.isSafeInteger(counter) || counter < 0)) {
      throw new Error("paid-user snapshot counters must be non-negative safe integers");
    }
    if (
      snapshot.unseenActionableTotal > snapshot.actionableTotal ||
      snapshot.actionableTotal > snapshot.uniqueTotal ||
      snapshot.uniqueTotal > snapshot.relevantTotal ||
      snapshot.routeKnownTotal > snapshot.relevantTotal ||
      snapshot.directEmployerTotal > snapshot.relevantTotal
    ) {
      throw new Error("paid-user snapshot counters violate aggregate monotonicity");
    }
  }
  if (!snapshots.length) {
    return {
      cohortSize: 0,
      p10: null,
      median: null,
      p90: null,
      feedExhaustionRate: null,
      routeKnownRate: null,
      directEmployerRate: null,
      terminalReasonCounts: {},
    };
  }
  const unseen = snapshots.map((snapshot) => snapshot.unseenActionableTotal);
  const relevant = snapshots.reduce((sum, snapshot) => sum + snapshot.relevantTotal, 0);
  const terminalReasonCounts: Record<string, number> = {};
  for (const snapshot of snapshots) {
    terminalReasonCounts[snapshot.terminalReason] =
      (terminalReasonCounts[snapshot.terminalReason] ?? 0) + 1;
  }
  return {
    cohortSize: snapshots.length,
    p10: percentile(unseen, 0.1),
    median: percentile(unseen, 0.5),
    p90: percentile(unseen, 0.9),
    feedExhaustionRate:
      snapshots.filter((snapshot) => snapshot.unseenActionableTotal === 0).length /
      snapshots.length,
    routeKnownRate:
      relevant === 0
        ? null
        : snapshots.reduce((sum, snapshot) => sum + snapshot.routeKnownTotal, 0) / relevant,
    directEmployerRate:
      relevant === 0
        ? null
        : snapshots.reduce((sum, snapshot) => sum + snapshot.directEmployerTotal, 0) / relevant,
    terminalReasonCounts: Object.fromEntries(
      Object.entries(terminalReasonCounts).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function manifestInput(
  manifest: FranceTravailCensusManifestInput | FranceTravailCensusManifest,
): FranceTravailCensusManifestInput {
  const { manifestDigest: _manifestDigest, ...input } = manifest as FranceTravailCensusManifest;
  return input;
}

export function freezeFranceTravailCensusManifest(
  input: FranceTravailCensusManifestInput,
): FranceTravailCensusManifest {
  const privacyFailures = validateAggregateDimensions(input.profileStrata, "profileStrata");
  if (privacyFailures.length) {
    throw new Error(`unsafe France Travail profile strata: ${privacyFailures.join(",")}`);
  }
  const frozen = structuredClone({
    ...input,
    profileStrata: [...input.profileStrata].sort((left, right) =>
      stableDigest(left).localeCompare(stableDigest(right)),
    ),
    partitions: [...input.partitions]
      .map((partition) => ({
        ...partition,
        parameters: Object.fromEntries(
          Object.entries(partition.parameters).sort(([left], [right]) => left.localeCompare(right)),
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
  return {
    ...frozen,
    manifestDigest: stableDigest(frozen),
  };
}

export function validateFranceTravailCensusManifest(
  manifest: FranceTravailCensusManifest,
): string[] {
  const failures: string[] = [];
  if (manifest.schemaVersion !== 1) failures.push("unsupported_manifest_schema");
  if (!manifest.manifestVersion.trim()) failures.push("missing_manifest_version");
  if (!/^[0-9a-f]{64}$/.test(manifest.paidCohortSnapshotHash)) {
    failures.push("invalid_paid_cohort_snapshot_hash");
  }
  if (!manifest.samplingSeed.trim()) failures.push("missing_sampling_seed");
  failures.push(...validateAggregateDimensions(manifest.profileStrata, "profileStrata"));
  if (manifest.capRules.pageSize < 1 || manifest.capRules.pageSize > 150) {
    failures.push("invalid_page_size");
  }
  if (manifest.capRules.maxRecordsPerPartition < manifest.capRules.pageSize) {
    failures.push("invalid_partition_cap");
  }
  if (stableDigest(manifestInput(manifest)) !== manifest.manifestDigest) {
    failures.push("manifest_digest_mismatch");
  }

  const ids = new Set<string>();
  const partitionsByParameters = new Map<string, FranceTravailCensusPartition[]>();
  for (const partition of manifest.partitions) {
    if (ids.has(partition.id)) failures.push(`duplicate_partition:${partition.id}`);
    ids.add(partition.id);
    const start = Date.parse(partition.publishedAfter);
    const end = Date.parse(partition.publishedBefore);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      failures.push(`invalid_partition_window:${partition.id}`);
      continue;
    }
    const key = stableDigest(partition.parameters);
    partitionsByParameters.set(key, [...(partitionsByParameters.get(key) ?? []), partition]);
  }
  for (const partitions of partitionsByParameters.values()) {
    const sorted = [...partitions].sort(
      (left, right) => Date.parse(left.publishedAfter) - Date.parse(right.publishedAfter),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (Date.parse(current.publishedAfter) < Date.parse(previous.publishedBefore)) {
        failures.push(`overlapping_partition_windows:${previous.id}:${current.id}`);
      }
    }
  }
  return [...new Set(failures)].sort();
}

export function reconcileFranceTravailPartition(
  accounting: FranceTravailPartitionAccounting,
): string[] {
  const failures: string[] = [];
  const residual = Object.values(accounting.namedResiduals).reduce((sum, count) => sum + count, 0);
  if (accounting.httpRecords !== accounting.uniqueExternalIds + accounting.duplicateRawRecords) {
    failures.push("http_unique_accounting_mismatch");
  }
  if (accounting.uniqueExternalIds !== accounting.normalized + accounting.rejectedNormalization) {
    failures.push("normalization_accounting_mismatch");
  }
  if (
    accounting.normalized !==
    accounting.occurrenceInserted +
      accounting.occurrenceUpdated +
      accounting.occurrenceDeduplicated +
      accounting.writeFailed
  ) {
    failures.push("occurrence_accounting_mismatch");
  }
  if (
    accounting.sourceReportedTotal !== null &&
    accounting.sourceReportedTotal !== accounting.uniqueExternalIds + residual
  ) {
    failures.push("source_total_accounting_mismatch");
  }
  if (accounting.actionable > accounting.active || accounting.relevant > accounting.actionable) {
    failures.push("coverage_stage_order_mismatch");
  }
  if (accounting.status === "complete" && accounting.sourceReportedTotal === null) {
    failures.push("complete_without_source_total");
  }
  if (accounting.status === "complete" && residual > 0) {
    failures.push("complete_with_residuals");
  }
  if (
    (accounting.status === "capped" || accounting.status === "blocked") &&
    !accounting.blockerReason?.trim()
  ) {
    failures.push(`${accounting.status}_without_reason`);
  }
  return [...new Set(failures)].sort();
}

export function evaluatePartition(partition: PartitionFact): string[] {
  const failures: string[] = [];
  const unique = (values: string[]) => [...new Set(values)].sort();
  const expected = unique(partition.expectedExternalIds);
  const fetched = unique(partition.fetchedExternalIds);
  const completed = partition.status.startsWith("completed");

  if (partition.status === "never_run") failures.push("nonterminal_partition");
  if (new Set(partition.cursorHistory).size !== partition.cursorHistory.length) {
    failures.push(
      partition.cursorHistory.length > 2 &&
        partition.cursorHistory.at(-1) === partition.cursorHistory[0]
        ? "cursor_cycle"
        : "repeated_cursor",
    );
  }
  if (JSON.stringify(expected) !== JSON.stringify(fetched)) {
    failures.push("external_id_set_mismatch");
  }
  if (partition.sourceTotal !== null && fetched.length !== partition.sourceTotal) {
    failures.push("source_total_mismatch");
  }
  if (partition.cap !== null && partition.fetchedExternalIds.length >= partition.cap) {
    failures.push(completed ? "cap_hit_marked_complete" : "cap_hit_requires_split");
  }
  if (partition.termination === "empty_intermediate_page") {
    failures.push("unexpected_empty_intermediate_page");
  }
  if (
    partition.failure === "rate_limit" &&
    (!partition.retryCount || !partition.recoveredAfterRetry)
  ) {
    failures.push("rate_limit_not_retried");
  }
  if (
    partition.failure === "transient_network" &&
    (!partition.retryCount || !partition.recoveredAfterRetry)
  ) {
    failures.push("transient_failure_not_retried");
  }
  if (partition.failure === "permanent_page") {
    failures.push("permanent_page_failure");
    if (completed) failures.push("page_failure_marked_complete");
  }
  if (
    partition.pageBase !== undefined &&
    partition.configuredPageBase !== undefined &&
    partition.pageBase !== partition.configuredPageBase
  ) {
    failures.push("invalid_page_base");
  }
  if (
    partition.boundaryOperator !== undefined &&
    partition.expectedBoundaryOperator !== undefined &&
    partition.boundaryOperator !== partition.expectedBoundaryOperator
  ) {
    failures.push("boundary_gap");
  }
  if (partition.uniqueSortTieBreaker === false) {
    failures.push("missing_unique_tie_breaker");
  }
  if (
    partition.mutationDuringPagination &&
    partition.mutationDuringPagination !== "none" &&
    !partition.mutationHandled
  ) {
    failures.push("mutation_gap");
  }
  return [...new Set(failures)].sort();
}

export function validatePaginationFixtures(partitions: PartitionFact[]): string[] {
  const requiredIds = new Set([
    "one-page",
    "exact-full-page",
    "full-plus-one",
    "several-full-pages",
    "partial-final-page",
    "empty-first-page",
    "empty-intermediate-page",
    "repeated-cursor",
    "cursor-cycle",
    "adjacent-page-duplicates",
    "concurrent-insert",
    "concurrent-delete",
    "rate-limit-retry",
    "transient-network-retry",
    "permanent-page-failure",
    "page-base-zero",
    "page-base-one",
    "wrong-page-base",
    "boundary-less-than",
    "boundary-less-than-equal",
    "wrong-boundary",
    "identical-sort-with-tie-breaker",
    "identical-sort-without-tie-breaker",
    "cap-hit",
    "source-total-mismatch",
  ]);
  const present = new Set(partitions.map((partition) => partition.id.replace(/^PAG-\d+-/, "")));
  const failures = [...requiredIds]
    .filter((id) => !present.has(id))
    .map((id) => `missing_pagination_case:${id}`);
  if (partitions.length !== requiredIds.size) {
    failures.push(`pagination_case_count:${partitions.length}/${requiredIds.size}`);
  }
  for (const partition of partitions) {
    const actual = evaluatePartition(partition);
    const expected = [...(partition.expectedFailures ?? [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${partition.id}:unexpected_evaluation:${actual.join(",") || "none"}!=${expected.join(",") || "none"}`,
      );
    }
  }
  return failures;
}

export function materializeCoverage(manifest: CoverageManifest): MaterializedCoverage {
  const records: CoverageRecord[] = [];
  for (const provider of manifest.dimensions.provider) {
    const rules = manifest.terminalRules.filter((rule) => rule.providers.includes(provider));
    if (rules.length !== 1) continue;
    const rule = rules[0];
    for (const contractType of manifest.dimensions.contractType) {
      for (const geography of manifest.dimensions.geography) {
        for (const occupation of manifest.dimensions.occupation) {
          records.push({
            partitionId: [provider, contractType, geography, occupation].join(":"),
            provider,
            contractType,
            geography,
            occupation,
            status: rule.state,
            blocker:
              rule.state === "blocked"
                ? {
                    dependency: rule.dependency,
                    capabilityCheck: rule.capabilityCheck,
                    unblockProcedure: rule.unblockProcedure,
                  }
                : null,
          });
        }
      }
    }
  }
  return { schemaVersion: 3, records };
}

export function validateCoverageManifest(
  manifest: CoverageManifest,
  materialized = materializeCoverage(manifest),
): string[] {
  const failures: string[] = [];
  const { provider, contractType, geography, occupation } = manifest.dimensions;
  const expectedCount =
    provider.length * contractType.length * geography.length * occupation.length;
  if (materialized.records.length !== expectedCount) {
    failures.push(`coverage_partition_count:${materialized.records.length}/${expectedCount}`);
  }
  const allowedTerminal = new Set([
    "completed_with_results",
    "completed_zero_results",
    "failed",
    "blocked",
  ]);
  const ids = new Set<string>();
  const expectedIds = new Set(
    provider.flatMap((p) =>
      contractType.flatMap((c) =>
        geography.flatMap((g) => occupation.map((o) => [p, c, g, o].join(":"))),
      ),
    ),
  );
  for (const record of materialized.records) {
    if (ids.has(record.partitionId)) failures.push(`coverage_duplicate:${record.partitionId}`);
    ids.add(record.partitionId);
    if (!allowedTerminal.has(record.status))
      failures.push(`coverage_nonterminal:${record.partitionId}`);
    if (
      record.status === "blocked" &&
      (!record.blocker?.dependency ||
        !record.blocker.capabilityCheck ||
        !record.blocker.unblockProcedure)
    )
      failures.push(`coverage_unjustified_block:${record.partitionId}`);
  }
  for (const id of expectedIds) if (!ids.has(id)) failures.push(`coverage_missing:${id}`);
  for (const id of ids) if (!expectedIds.has(id)) failures.push(`coverage_unexpected:${id}`);
  return failures;
}

export function reconcileFunnel(funnel: Funnel): string[] {
  const failures: string[] = [];
  const rejected = Object.values(funnel.rejectedByReason).reduce((sum, count) => sum + count, 0);
  if (funnel.rawReceived !== funnel.normalized + funnel.rejectedNormalization) {
    failures.push("raw_normalization_mismatch");
  }
  if (funnel.normalized !== funnel.acceptedAfterFilters + rejected) {
    failures.push("filter_accounting_mismatch");
  }
  if (
    funnel.acceptedAfterFilters !==
    funnel.newIdentity +
      funnel.existingIdentity +
      funnel.duplicateOccurrence +
      funnel.fuzzyCandidateOnly
  ) {
    failures.push("identity_accounting_mismatch");
  }
  return failures;
}

export function validateRows(rows: AuditRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.status === "FAIL") return [`${row.riskId}:internal_failure`];
    if (row.status === "BLOCKED_EXTERNAL" && !row.blocker)
      return [`${row.riskId}:unjustified_block`];
    if (row.status === "PASS" && !row.reproductionCommand)
      return [`${row.riskId}:missing_reproduction`];
    return [];
  });
}
