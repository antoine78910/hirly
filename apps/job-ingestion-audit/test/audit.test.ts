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

const partitions = JSON.parse(readFileSync(
  new URL("../fixtures/pagination-golden.json", import.meta.url),
  "utf8",
)) as PartitionFact[];
const coverageManifest = JSON.parse(readFileSync(
  new URL("../fixtures/coverage-manifest.json", import.meta.url),
  "utf8",
)) as CoverageManifest;
const franceTravailCensusManifest = JSON.parse(readFileSync(
  new URL("../fixtures/france-travail-census-manifest.json", import.meta.url),
  "utf8",
)) as {
  schemaVersion: number;
  paidCohort: {
    snapshotHash: string;
    samplingSeed: string;
    strata: Array<{ id: string; weight: number }>;
  };
  partitionRules: {
    order: string[];
    retrievableCap: number;
    splitOnlyWhenAboveCap: boolean;
  };
  partitions: Array<{
    id: string;
    publishedFrom: string;
    publishedUntil: string;
    terminalState: "complete" | "capped" | "blocked" | "failed";
    sourceReportedTotal: number | null;
    fetched: number;
    normalized: number;
    rejectedByReason: Record<string, number>;
    occurrenceDeduplicated: number;
    inserted: number;
    updated: number;
    active: number;
    actionable: number;
  }>;
  manifestDigest: string;
};

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

  test("freezes a deterministic, cohort-weighted France Travail census manifest", () => {
    const { manifestDigest, ...digestInput } = franceTravailCensusManifest;
    expect(manifestDigest).toBe(stableDigest(digestInput));
    expect(franceTravailCensusManifest.paidCohort.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(franceTravailCensusManifest.paidCohort.samplingSeed).not.toHaveLength(0);
    expect(
      franceTravailCensusManifest.paidCohort.strata.reduce(
        (total, stratum) => total + stratum.weight,
        0,
      ),
    ).toBeCloseTo(1, 10);
    expect(franceTravailCensusManifest.partitionRules.order).toEqual([
      "publication_window",
      "rome",
      "department",
      "contract",
    ]);
    expect(franceTravailCensusManifest.partitionRules.splitOnlyWhenAboveCap).toBe(true);
    expect(new Set(franceTravailCensusManifest.partitions.map(({ id }) => id)).size)
      .toBe(franceTravailCensusManifest.partitions.length);
  });

  test("uses non-overlapping windows and reconciles every terminal census partition", () => {
    const partitions = [...franceTravailCensusManifest.partitions].sort(
      (left, right) => left.publishedFrom.localeCompare(right.publishedFrom),
    );
    for (const [index, partition] of partitions.entries()) {
      const rejected = Object.values(partition.rejectedByReason)
        .reduce((total, count) => total + count, 0);
      expect(partition.fetched).toBe(partition.normalized + rejected);
      expect(partition.normalized).toBe(
        partition.occurrenceDeduplicated + partition.inserted + partition.updated,
      );
      expect(partition.actionable).toBeLessThanOrEqual(partition.active);
      if (partition.terminalState === "complete" && partition.sourceReportedTotal !== null) {
        expect(partition.fetched).toBe(partition.sourceReportedTotal);
      }
      if (partition.terminalState === "capped") {
        expect(partition.fetched).toBe(franceTravailCensusManifest.partitionRules.retrievableCap);
        expect(partition.sourceReportedTotal).toBeGreaterThan(partition.fetched);
      }
      if (index > 0) {
        expect(partitions[index - 1].publishedUntil <= partition.publishedFrom).toBe(true);
      }
    }
  });
});
