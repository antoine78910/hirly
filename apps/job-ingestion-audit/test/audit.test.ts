import { describe, expect, test } from "bun:test";
import {
  computePaidUserCoverageBaseline,
  evaluatePartition,
  freezeFranceTravailCensusManifest,
  materializeCoverage,
  reconcileFranceTravailPartition,
  reconcileFunnel,
  validateFranceTravailCensusManifest,
  validatePaginationFixtures,
  validateCoverageManifest,
  validateRows,
  type FranceTravailCensusManifestInput,
  type PartitionFact,
  type CoverageManifest,
} from "../src/audit";
import {
  ExternalDependencyBlockedError,
  runFranceTravailLiveCensus,
} from "../src/france-travail-census";
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
const franceTravailCensusInput = JSON.parse(readFileSync(
  new URL("../fixtures/france-travail-census-manifest.json", import.meta.url),
  "utf8",
)) as FranceTravailCensusManifestInput;

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

  test("computes paid-user coverage percentiles and exhaustion from aggregate snapshots", () => {
    expect(computePaidUserCoverageBaseline([
      {
        userHash: "a".repeat(64), unseenActionableTotal: 0, actionableTotal: 2,
        routeKnownTotal: 1, directEmployerTotal: 1, terminalReason: "exhausted",
      },
      {
        userHash: "b".repeat(64), unseenActionableTotal: 5, actionableTotal: 5,
        routeKnownTotal: 4, directEmployerTotal: 2, terminalReason: "results",
      },
      {
        userHash: "c".repeat(64), unseenActionableTotal: 10, actionableTotal: 10,
        routeKnownTotal: 10, directEmployerTotal: 8, terminalReason: "results",
      },
    ])).toEqual({
      cohortSize: 3,
      p10: 1,
      median: 5,
      p90: 9,
      feedExhaustionRate: 1 / 3,
      routeKnownRate: 15 / 17,
      directEmployerRate: 11 / 17,
      terminalReasonCounts: { exhausted: 1, results: 2 },
    });
  });

  test("freezes a deterministic, cohort-weighted France Travail census manifest", () => {
    const manifest = freezeFranceTravailCensusManifest(franceTravailCensusInput);
    expect(manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(validateFranceTravailCensusManifest(manifest)).toEqual([]);
    expect(manifest.paidCohortSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.samplingSeed).not.toHaveLength(0);
    expect(
      manifest.profileStrata.reduce(
        (total, stratum) => total + Number(stratum.weight),
        0,
      ),
    ).toBeCloseTo(1, 10);
    expect(new Set(manifest.partitions.map(({ id }) => id)).size)
      .toBe(manifest.partitions.length);
    expect(
      Date.parse(manifest.partitions[0].publishedBefore),
    ).toBeLessThanOrEqual(Date.parse(manifest.partitions[1].publishedAfter));
  });

  test("reconciles every terminal France Travail partition through actionable supply", () => {
    expect(reconcileFranceTravailPartition({
      partitionId: "ft:test",
      status: "complete",
      sourceReportedTotal: 5,
      httpRecords: 5,
      uniqueExternalIds: 4,
      duplicateRawRecords: 1,
      normalized: 3,
      rejectedNormalization: 1,
      occurrenceInserted: 1,
      occurrenceUpdated: 1,
      occurrenceDeduplicated: 1,
      writeFailed: 0,
      active: 3,
      actionable: 2,
      relevant: 2,
      namedResiduals: {},
    })).toEqual([]);
  });

  test("persists Content-Range totals and fails closed when a partition exceeds the cap", async () => {
    const input = {
      ...franceTravailCensusInput,
      capRules: {
        ...franceTravailCensusInput.capRules,
        maxRecordsPerPartition: 150,
      },
      partitions: [franceTravailCensusInput.partitions[0]],
    };
    const result = await runFranceTravailLiveCensus(
      freezeFranceTravailCensusManifest(input),
      {
        accessToken: "fixture-token",
        fetcher: async () => new Response(JSON.stringify({
          resultats: [{ id: "one" }, { id: "two" }],
        }), {
          status: 206,
          headers: { "content-range": "offres 0-1/151" },
        }),
      },
    );
    expect(result.partitions).toEqual([{
      partitionId: input.partitions[0].id,
      status: "capped",
      sourceReportedTotal: 151,
      httpRecords: 2,
      uniqueExternalIds: ["one", "two"],
      duplicateRawRecords: 0,
      requests: 1,
      retries: 0,
      terminalReason: "source_total_exceeds_partition_cap",
    }]);
  });

  test("reports a truthful external blocker when live France Travail credentials are absent", async () => {
    expect(
      runFranceTravailLiveCensus(
        freezeFranceTravailCensusManifest(franceTravailCensusInput),
      ),
    ).rejects.toBeInstanceOf(ExternalDependencyBlockedError);
  });
});
