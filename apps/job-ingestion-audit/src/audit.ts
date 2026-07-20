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
  termination?: "partial_page" | "empty_first_page" | "empty_intermediate_page" | "source_total" | "cap" | "failure";
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
  terminalRules: Array<{ providers: string[]; state: string; reason: string }>;
  expandedPartitionCount: number;
  terminalCounts: Record<string, number>;
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

export function evaluatePartition(partition: PartitionFact): string[] {
  const failures: string[] = [];
  const unique = (values: string[]) => [...new Set(values)].sort();
  const expected = unique(partition.expectedExternalIds);
  const fetched = unique(partition.fetchedExternalIds);
  const completed = partition.status.startsWith("completed");

  if (partition.status === "never_run") failures.push("nonterminal_partition");
  if (new Set(partition.cursorHistory).size !== partition.cursorHistory.length) {
    failures.push(
      partition.cursorHistory.length > 2 && partition.cursorHistory.at(-1) === partition.cursorHistory[0]
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
  if (partition.failure === "rate_limit" && (!partition.retryCount || !partition.recoveredAfterRetry)) {
    failures.push("rate_limit_not_retried");
  }
  if (partition.failure === "transient_network" && (!partition.retryCount || !partition.recoveredAfterRetry)) {
    failures.push("transient_failure_not_retried");
  }
  if (partition.failure === "permanent_page") {
    failures.push("permanent_page_failure");
    if (completed) failures.push("page_failure_marked_complete");
  }
  if (
    partition.pageBase !== undefined
    && partition.configuredPageBase !== undefined
    && partition.pageBase !== partition.configuredPageBase
  ) {
    failures.push("invalid_page_base");
  }
  if (
    partition.boundaryOperator !== undefined
    && partition.expectedBoundaryOperator !== undefined
    && partition.boundaryOperator !== partition.expectedBoundaryOperator
  ) {
    failures.push("boundary_gap");
  }
  if (partition.uniqueSortTieBreaker === false) {
    failures.push("missing_unique_tie_breaker");
  }
  if (partition.mutationDuringPagination && partition.mutationDuringPagination !== "none" && !partition.mutationHandled) {
    failures.push("mutation_gap");
  }
  return [...new Set(failures)].sort();
}

export function validatePaginationFixtures(partitions: PartitionFact[]): string[] {
  const requiredIds = new Set([
    "one-page", "exact-full-page", "full-plus-one", "several-full-pages", "partial-final-page",
    "empty-first-page", "empty-intermediate-page", "repeated-cursor", "cursor-cycle",
    "adjacent-page-duplicates", "concurrent-insert", "concurrent-delete", "rate-limit-retry",
    "transient-network-retry", "permanent-page-failure", "page-base-zero", "page-base-one",
    "wrong-page-base", "boundary-less-than", "boundary-less-than-equal", "wrong-boundary",
    "identical-sort-with-tie-breaker", "identical-sort-without-tie-breaker", "cap-hit",
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
      failures.push(`${partition.id}:unexpected_evaluation:${actual.join(",") || "none"}!=${expected.join(",") || "none"}`);
    }
  }
  return failures;
}

export function validateCoverageManifest(manifest: CoverageManifest): string[] {
  const failures: string[] = [];
  const { provider, contractType, geography, occupation } = manifest.dimensions;
  const expectedCount = provider.length * contractType.length * geography.length * occupation.length;
  if (manifest.expandedPartitionCount !== expectedCount) {
    failures.push(`coverage_partition_count:${manifest.expandedPartitionCount}/${expectedCount}`);
  }
  const allowedTerminal = new Set(["completed_with_results", "completed_zero_results", "failed", "blocked"]);
  const providerMatches = new Map(provider.map((name) => [name, 0]));
  for (const rule of manifest.terminalRules) {
    if (!allowedTerminal.has(rule.state)) failures.push(`coverage_nonterminal_rule:${rule.state}`);
    if (!rule.reason.trim()) failures.push("coverage_rule_missing_reason");
    for (const name of rule.providers) {
      if (!providerMatches.has(name)) failures.push(`coverage_unknown_provider:${name}`);
      else providerMatches.set(name, (providerMatches.get(name) ?? 0) + 1);
    }
  }
  for (const [name, matches] of providerMatches) {
    if (matches !== 1) failures.push(`coverage_provider_rule_count:${name}:${matches}`);
  }
  const terminalTotal = Object.entries(manifest.terminalCounts)
    .filter(([status]) => status !== "nonterminal")
    .reduce((sum, [, count]) => sum + count, 0);
  if (terminalTotal !== expectedCount) failures.push(`coverage_terminal_count:${terminalTotal}/${expectedCount}`);
  if ((manifest.terminalCounts.nonterminal ?? 0) !== 0) failures.push("coverage_has_nonterminal_partitions");
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
    funnel.newIdentity + funnel.existingIdentity + funnel.duplicateOccurrence + funnel.fuzzyCandidateOnly
  ) {
    failures.push("identity_accounting_mismatch");
  }
  return failures;
}

export function validateRows(rows: AuditRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.status === "FAIL") return [`${row.riskId}:internal_failure`];
    if (row.status === "BLOCKED_EXTERNAL" && !row.blocker) return [`${row.riskId}:unjustified_block`];
    if (row.status === "PASS" && !row.reproductionCommand) return [`${row.riskId}:missing_reproduction`];
    return [];
  });
}
