import { describe, expect, test } from "bun:test";
import {
  evaluatePartition,
  materializeCoverage,
  reconcileFunnel,
  stableDigest,
  validatePaginationFixtures,
  validateCoverageManifest,
  validateRows,
  type PartitionFact,
  type CoverageManifest,
} from "../src/audit";
import { readFileSync } from "node:fs";
import {
  buildFranceTravailCensusManifest,
  summarizePaidUserCoverage,
  type FranceTravailPartitionEvidence,
} from "../src/observability";

const partitions = JSON.parse(readFileSync(
  new URL("../fixtures/pagination-golden.json", import.meta.url),
  "utf8",
)) as PartitionFact[];
const coverageManifest = JSON.parse(readFileSync(
  new URL("../fixtures/coverage-manifest.json", import.meta.url),
  "utf8",
)) as CoverageManifest;
const franceTravailPartitions = JSON.parse(readFileSync(
  new URL("../fixtures/france-travail-census-partitions.json", import.meta.url),
  "utf8",
)) as FranceTravailPartitionEvidence[];

describe("job-ingestion audit invariants", () => {
  test("requires exact external-ID set equality", () => {
    expect(evaluatePartition({
      id: "PAG-SET",
      status: "completed_with_results",
      expectedExternalIds: ["a", "b"],
      fetchedExternalIds: ["a", "a"],
      sourceTotal: 2,
      cap: null,
      cursorHistory: ["0", "1"],
    })).toContain("external_id_set_mismatch");
  });

  test("rejects repeated cursors and successful cap hits", () => {
    expect(evaluatePartition({
      id: "PAG-CYCLE",
      status: "completed_with_results",
      expectedExternalIds: ["a", "b"],
      fetchedExternalIds: ["a", "b"],
      sourceTotal: 2,
      cap: 2,
      cursorHistory: ["cursor-a", "cursor-a"],
    })).toEqual(["cap_hit_marked_complete", "repeated_cursor"]);
  });

  test("covers every mandated pagination scenario and validates negative cases", () => {
    expect(partitions).toHaveLength(25);
    expect(validatePaginationFixtures(partitions)).toEqual([]);
    const permanentFailure = partitions.find((partition) => partition.id.endsWith("permanent-page-failure"));
    expect(permanentFailure).toBeDefined();
    expect(evaluatePartition(permanentFailure!)).toContain("permanent_page_failure");
  });

  test("expands every coverage combination to exactly one terminal rule", () => {
    const coverage = materializeCoverage(coverageManifest);
    expect(coverage.records).toHaveLength(1470);
    expect(new Set(coverage.records.map((record) => record.partitionId)).size).toBe(1470);
    expect(coverage.records.every((record) => record.status !== "blocked" || record.blocker)).toBe(true);
    expect(validateCoverageManifest(coverageManifest, coverage)).toEqual([]);
  });

  test("reconciles stage accounting", () => {
    expect(reconcileFunnel({
      rawReceived: 10,
      normalized: 9,
      rejectedNormalization: 1,
      acceptedAfterFilters: 7,
      rejectedByReason: { missing_title: 2 },
      newIdentity: 3,
      existingIdentity: 2,
      duplicateOccurrence: 1,
      fuzzyCandidateOnly: 1,
    })).toEqual([]);
  });

  test("only explicit external blocks are accepted", () => {
    expect(validateRows([{
      riskId: "SQL-001", suspectedFailure: "slow", affectedPath: "feed",
      references: [], reproductionCommand: "psql", expected: {}, actual: {},
      baseline: {}, rootCause: null, status: "BLOCKED_EXTERNAL", proposedFix: null,
      regressionTest: "SQL-001", finalEvidence: "artifacts/job-ingestion/sql/SQL-001",
    }])).toEqual(["SQL-001:unjustified_block"]);
  });

  test("fixture rows retain every pinned matrix input", () => {
    const rows = JSON.parse(readFileSync(
      new URL("../fixtures/audit-rows.json", import.meta.url),
      "utf8",
    ));
    for (const row of rows) {
      for (const field of [
        "riskId", "suspectedFailure", "affectedPath", "references",
        "reproductionCommand", "expected", "actual", "baseline", "rootCause",
        "status", "proposedFix", "regressionTest", "finalEvidence",
      ]) {
        expect(field in row).toBe(true);
      }
    }
  });

  test("computes paid-user percentiles and exhaustion from PR1 aggregates", () => {
    expect(summarizePaidUserCoverage([
      {
        hashedUserId: "a".repeat(64), relevantTotal: 4, uniqueTotal: 4,
        actionableTotal: 4, unseenActionableTotal: 0, routeKnownTotal: 4,
        directEmployerTotal: 1,
      },
      {
        hashedUserId: "b".repeat(64), relevantTotal: 10, uniqueTotal: 8,
        actionableTotal: 6, unseenActionableTotal: 4, routeKnownTotal: 7,
        directEmployerTotal: 2,
      },
      {
        hashedUserId: "c".repeat(64), relevantTotal: 20, uniqueTotal: 16,
        actionableTotal: 12, unseenActionableTotal: 8, routeKnownTotal: 14,
        directEmployerTotal: 4,
      },
    ])).toMatchObject({
      paidUsers: 3,
      p10: 0.8,
      median: 4,
      p90: 7.2,
      exhaustionRate: 1 / 3,
    });
  });

  test("builds deterministic immutable France Travail census evidence", () => {
    const generatedAt = "2026-07-20T00:00:00.000Z";
    const first = buildFranceTravailCensusManifest(franceTravailPartitions, generatedAt);
    const second = buildFranceTravailCensusManifest(
      [...franceTravailPartitions].reverse(),
      generatedAt,
    );
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      terminalState: "complete",
      partitionCount: 2,
      sourceReportedTotal: 2,
      fetchedRecords: 2,
      normalizedRecords: 2,
      rejectedRecords: 0,
      actionableRecords: 2,
    });
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("marks cap pressure non-complete and rejects unreconciled accounting", () => {
    expect(buildFranceTravailCensusManifest([
      { ...franceTravailPartitions[0]!, capHit: true },
    ], "2026-07-20T00:00:00.000Z").terminalState).toBe("capped");
    expect(() => buildFranceTravailCensusManifest([
      { ...franceTravailPartitions[0]!, normalizedRecords: 1 },
    ], "2026-07-20T00:00:00.000Z")).toThrow(
      "france_travail_partition_accounting",
    );
  });
});
