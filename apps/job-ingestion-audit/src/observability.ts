import { stableDigest } from "./audit";

export interface PaidUserCoverageSnapshot {
  hashedUserId: string;
  relevantTotal: number;
  uniqueTotal: number;
  actionableTotal: number;
  unseenActionableTotal: number;
  routeKnownTotal: number;
  directEmployerTotal: number;
}

export interface CoverageBaseline {
  paidUsers: number;
  p10: number;
  median: number;
  p90: number;
  exhaustionRate: number;
  digest: string;
}

export interface FranceTravailPartitionEvidence {
  runId: string;
  partitionId: string;
  status: "completed_with_results" | "completed_zero_results" | "failed" | "blocked";
  sourceReportedTotal: number | null;
  fetchedRecords: number;
  normalizedRecords: number;
  rejectedRecords: number;
  actionableRecords: number;
  capHit: boolean;
}

export interface FranceTravailCensusManifest {
  schemaVersion: 1;
  generatedAt: string;
  source: "france_travail";
  sourceRunIds: string[];
  partitionCount: number;
  terminalState: "complete" | "capped" | "blocked" | "failed";
  sourceReportedTotal: number | null;
  fetchedRecords: number;
  normalizedRecords: number;
  rejectedRecords: number;
  actionableRecords: number;
  partitions: FranceTravailPartitionEvidence[];
  digest: string;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

export function summarizePaidUserCoverage(
  snapshots: PaidUserCoverageSnapshot[],
): CoverageBaseline {
  for (const snapshot of snapshots) {
    if (!/^[0-9a-f]{64}$/.test(snapshot.hashedUserId)) {
      throw new Error("paid_user_coverage_requires_sha256_user_hash");
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
      throw new Error("paid_user_coverage_requires_non_negative_integer_counters");
    }
    if (
      snapshot.unseenActionableTotal > snapshot.actionableTotal
      || snapshot.actionableTotal > snapshot.uniqueTotal
      || snapshot.uniqueTotal > snapshot.relevantTotal
      || snapshot.routeKnownTotal > snapshot.relevantTotal
      || snapshot.directEmployerTotal > snapshot.relevantTotal
    ) {
      throw new Error("paid_user_coverage_counter_order");
    }
  }
  const unseen = snapshots
    .map(({ unseenActionableTotal }) => unseenActionableTotal)
    .sort((left, right) => left - right);
  const exhausted = unseen.filter((count) => count === 0).length;
  const digestRows = snapshots
    .map((snapshot) => ({ ...snapshot }))
    .sort((left, right) => left.hashedUserId.localeCompare(right.hashedUserId));
  return {
    paidUsers: snapshots.length,
    p10: percentile(unseen, 0.1),
    median: percentile(unseen, 0.5),
    p90: percentile(unseen, 0.9),
    exhaustionRate: snapshots.length === 0 ? 0 : exhausted / snapshots.length,
    digest: stableDigest(digestRows),
  };
}

function terminalState(
  partitions: FranceTravailPartitionEvidence[],
): FranceTravailCensusManifest["terminalState"] {
  if (partitions.some(({ status }) => status === "failed")) return "failed";
  if (partitions.some(({ status }) => status === "blocked")) return "blocked";
  if (partitions.some(({ capHit }) => capHit)) return "capped";
  if (partitions.some((partition) => (
    partition.sourceReportedTotal !== null
    && partition.sourceReportedTotal !== partition.fetchedRecords
  ))) return "capped";
  return "complete";
}

export function buildFranceTravailCensusManifest(
  evidence: FranceTravailPartitionEvidence[],
  generatedAt: string,
): FranceTravailCensusManifest {
  if (evidence.length === 0) throw new Error("france_travail_census_requires_partitions");
  const partitions = evidence
    .map((partition) => ({ ...partition }))
    .sort((left, right) => (
      left.runId.localeCompare(right.runId)
      || left.partitionId.localeCompare(right.partitionId)
    ));
  for (const partition of partitions) {
    if (
      partition.fetchedRecords !== partition.normalizedRecords + partition.rejectedRecords
      || partition.actionableRecords > partition.normalizedRecords
    ) {
      throw new Error(`france_travail_partition_accounting:${partition.partitionId}`);
    }
  }
  const totals = partitions.reduce((sum, partition) => ({
    fetchedRecords: sum.fetchedRecords + partition.fetchedRecords,
    normalizedRecords: sum.normalizedRecords + partition.normalizedRecords,
    rejectedRecords: sum.rejectedRecords + partition.rejectedRecords,
    actionableRecords: sum.actionableRecords + partition.actionableRecords,
  }), {
    fetchedRecords: 0,
    normalizedRecords: 0,
    rejectedRecords: 0,
    actionableRecords: 0,
  });
  const reportedTotals = partitions.map(({ sourceReportedTotal }) => sourceReportedTotal);
  const sourceReportedTotal = reportedTotals.every((total) => total !== null)
    ? (reportedTotals as number[]).reduce((sum, total) => sum + total, 0)
    : null;
  const manifestWithoutDigest = {
    schemaVersion: 1 as const,
    generatedAt,
    source: "france_travail" as const,
    sourceRunIds: [...new Set(partitions.map(({ runId }) => runId))].sort(),
    partitionCount: partitions.length,
    terminalState: terminalState(partitions),
    sourceReportedTotal,
    ...totals,
    partitions,
  };
  const { generatedAt: _generatedAt, ...immutableDecisionInputs } =
    manifestWithoutDigest;
  return {
    ...manifestWithoutDigest,
    digest: stableDigest(immutableDecisionInputs),
  };
}
