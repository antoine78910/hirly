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
  if (partition.status.startsWith("completed")) {
    if (new Set(partition.cursorHistory).size !== partition.cursorHistory.length) {
      failures.push("repeated_cursor");
    }
    if (JSON.stringify(unique(partition.expectedExternalIds)) !== JSON.stringify(unique(partition.fetchedExternalIds))) {
      failures.push("external_id_set_mismatch");
    }
    if (partition.sourceTotal !== null && unique(partition.fetchedExternalIds).length !== partition.sourceTotal) {
      failures.push("source_total_mismatch");
    }
    if (partition.cap !== null && partition.fetchedExternalIds.length >= partition.cap) {
      failures.push("cap_hit_marked_complete");
    }
  }
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
