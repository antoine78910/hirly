import { describe, expect, test } from "bun:test";
import {
  computePaidUserCoverageBaseline,
  evaluatePartition,
  freezeFranceTravailCensusManifest,
  materializeCoverage,
  reconcileFunnel,
  reconcileFranceTravailPartition,
  stableDigest,
  validatePaginationFixtures,
  validateCoverageManifest,
  validateFranceTravailCensusManifest,
  validateRows,
  type FranceTravailCensusManifestInput,
  type PartitionFact,
  type CoverageManifest,
} from "../src/audit";
import {
  ExternalDependencyBlockedError,
  parseContentRange,
  runFranceTravailLiveCensus,
} from "../src/france-travail-census";
import {
  JOB_SUPPLY_OBSERVABILITY_QUERIES,
  assertReadOnlyObservabilityQueries,
  runJobSupplyObservabilityQueries,
} from "../src/queries";
import { readFileSync } from "node:fs";
import { buildFranceTravailCensusManifest } from "../src/observability";

const partitions = JSON.parse(
  readFileSync(new URL("../fixtures/pagination-golden.json", import.meta.url), "utf8"),
) as PartitionFact[];
const coverageManifest = JSON.parse(
  readFileSync(new URL("../fixtures/coverage-manifest.json", import.meta.url), "utf8"),
) as CoverageManifest;
const franceTravailManifestInput = JSON.parse(
  readFileSync(new URL("../fixtures/france-travail-census-manifest.json", import.meta.url), "utf8"),
) as FranceTravailCensusManifestInput;
const trackedAuditResult = JSON.parse(
  readFileSync(
    new URL("../../../artifacts/job-ingestion/audit-result.json", import.meta.url),
    "utf8",
  ),
);
const trackedRunResult = JSON.parse(
  readFileSync(
    new URL("../../../artifacts/job-ingestion/audit-run-results.json", import.meta.url),
    "utf8",
  ),
);

function auditRunChecksum(artifact: {
  runId: string;
  generatedAt: string;
  datasetDigest: string;
  verdict: string;
  invariantFailures: unknown[];
  commandResults: unknown[];
  evidenceDigests: Record<string, string>;
}): string {
  return stableDigest({
    runId: artifact.runId,
    generatedAt: artifact.generatedAt,
    datasetDigest: artifact.datasetDigest,
    verdict: artifact.verdict,
    invariantFailures: artifact.invariantFailures,
    commandResults: artifact.commandResults,
    evidenceDigests: artifact.evidenceDigests,
  });
}

describe("job-ingestion audit invariants", () => {
  test("cryptographically binds both tracked artifacts to one audit run", () => {
    expect(trackedAuditResult.rows).toHaveLength(18);
    expect(trackedRunResult.commandResults).toHaveLength(18);
    for (const command of trackedRunResult.commandResults) {
      expect(typeof command.stdout).toBe("string");
      expect(typeof command.stderr).toBe("string");
      expect(command.checksum).toBe(
        stableDigest({
          command: command.command,
          exitCode: command.exitCode,
          rows: command.rows,
          executedAt: command.executedAt,
          stdout: command.stdout,
          stderr: command.stderr,
        }),
      );
    }
    for (const field of [
      "runId",
      "runChecksum",
      "generatedAt",
      "datasetDigest",
      "commandResults",
      "evidenceDigests",
    ]) {
      expect(trackedAuditResult[field]).toEqual(trackedRunResult[field]);
    }
    expect(trackedAuditResult.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(trackedAuditResult.runChecksum).toBe(auditRunChecksum(trackedAuditResult));
    expect(trackedRunResult.runChecksum).toBe(auditRunChecksum(trackedRunResult));
    expect(trackedRunResult.resultChecksum).toBe(trackedRunResult.runChecksum);
    expect(trackedRunResult.executedAt).toBe(trackedRunResult.generatedAt);

    const tamperedAudit = structuredClone(trackedAuditResult);
    tamperedAudit.evidenceDigests[Object.keys(tamperedAudit.evidenceDigests)[0]] = "0".repeat(64);
    expect(auditRunChecksum(tamperedAudit)).not.toBe(tamperedAudit.runChecksum);

    const staleRun = structuredClone(trackedRunResult);
    staleRun.runId = "00000000-0000-4000-8000-000000000000";
    expect(auditRunChecksum(staleRun)).not.toBe(staleRun.runChecksum);
  });
  test("requires exact external-ID set equality", () => {
    expect(
      evaluatePartition({
        id: "PAG-SET",
        status: "completed_with_results",
        expectedExternalIds: ["a", "b"],
        fetchedExternalIds: ["a", "a"],
        sourceTotal: 2,
        cap: null,
        cursorHistory: ["0", "1"],
      }),
    ).toContain("external_id_set_mismatch");
  });

  test("rejects repeated cursors and successful cap hits", () => {
    expect(
      evaluatePartition({
        id: "PAG-CYCLE",
        status: "completed_with_results",
        expectedExternalIds: ["a", "b"],
        fetchedExternalIds: ["a", "b"],
        sourceTotal: 2,
        cap: 2,
        cursorHistory: ["cursor-a", "cursor-a"],
      }),
    ).toEqual(["cap_hit_marked_complete", "repeated_cursor"]);
  });

  test("covers every mandated pagination scenario and validates negative cases", () => {
    expect(partitions).toHaveLength(25);
    expect(validatePaginationFixtures(partitions)).toEqual([]);
    const permanentFailure = partitions.find((partition) =>
      partition.id.endsWith("permanent-page-failure"),
    );
    expect(permanentFailure).toBeDefined();
    expect(evaluatePartition(permanentFailure)).toContain("permanent_page_failure");
  });

  test("expands every coverage combination to exactly one terminal rule", () => {
    const coverage = materializeCoverage(coverageManifest);
    expect(coverage.records).toHaveLength(1470);
    expect(new Set(coverage.records.map((record) => record.partitionId)).size).toBe(1470);
    expect(coverage.records.every((record) => record.status !== "blocked" || record.blocker)).toBe(
      true,
    );
    expect(validateCoverageManifest(coverageManifest, coverage)).toEqual([]);
  });

  test("reconciles stage accounting", () => {
    expect(
      reconcileFunnel({
        rawReceived: 10,
        normalized: 9,
        rejectedNormalization: 1,
        acceptedAfterFilters: 7,
        rejectedByReason: { missing_title: 2 },
        newIdentity: 3,
        existingIdentity: 2,
        duplicateOccurrence: 1,
        fuzzyCandidateOnly: 1,
      }),
    ).toEqual([]);
  });

  test("only explicit external blocks are accepted", () => {
    expect(
      validateRows([
        {
          riskId: "SQL-001",
          suspectedFailure: "slow",
          affectedPath: "feed",
          references: [],
          reproductionCommand: "psql",
          expected: {},
          actual: {},
          baseline: {},
          rootCause: null,
          status: "BLOCKED_EXTERNAL",
          proposedFix: null,
          regressionTest: "SQL-001",
          finalEvidence: "artifacts/job-ingestion/sql/SQL-001",
        },
      ]),
    ).toEqual(["SQL-001:unjustified_block"]);
  });

  test("fixture rows retain every pinned matrix input", () => {
    const rows = JSON.parse(
      readFileSync(new URL("../fixtures/audit-rows.json", import.meta.url), "utf8"),
    );
    for (const row of rows) {
      for (const field of [
        "riskId",
        "suspectedFailure",
        "affectedPath",
        "references",
        "reproductionCommand",
        "expected",
        "actual",
        "baseline",
        "rootCause",
        "status",
        "proposedFix",
        "regressionTest",
        "finalEvidence",
      ]) {
        expect(field in row).toBe(true);
      }
    }
  });

  test("computes paid-user percentiles, median and exhaustion from aggregate snapshots", () => {
    expect(
      computePaidUserCoverageBaseline([
        {
          userHash: "a".repeat(64),
          uniqueTotal: 3,
          relevantTotal: 3,
          unseenActionableTotal: 0,
          actionableTotal: 2,
          routeKnownTotal: 1,
          directEmployerTotal: 1,
          terminalReason: "exhausted",
        },
        {
          userHash: "b".repeat(64),
          uniqueTotal: 6,
          relevantTotal: 6,
          unseenActionableTotal: 5,
          actionableTotal: 5,
          routeKnownTotal: 4,
          directEmployerTotal: 2,
          terminalReason: "results",
        },
        {
          userHash: "c".repeat(64),
          uniqueTotal: 12,
          relevantTotal: 12,
          unseenActionableTotal: 10,
          actionableTotal: 10,
          routeKnownTotal: 10,
          directEmployerTotal: 8,
          terminalReason: "results",
        },
      ]),
    ).toEqual({
      cohortSize: 3,
      p10: 1,
      median: 5,
      p90: 9,
      feedExhaustionRate: 1 / 3,
      routeKnownRate: 15 / 21,
      directEmployerRate: 11 / 21,
      terminalReasonCounts: { exhausted: 1, results: 2 },
    });
    expect(computePaidUserCoverageBaseline([])).toMatchObject({
      cohortSize: 0,
      median: null,
      feedExhaustionRate: null,
    });
  });

  test("rejects PII and unhashed identities from aggregate coverage inputs", () => {
    expect(() =>
      computePaidUserCoverageBaseline([
        {
          userHash: "person@example.com",
          relevantTotal: 1,
          uniqueTotal: 1,
          actionableTotal: 1,
          unseenActionableTotal: 1,
          routeKnownTotal: 1,
          directEmployerTotal: 1,
          terminalReason: "results",
        },
      ]),
    ).toThrow("lowercase SHA-256 digest");
    expect(() =>
      freezeFranceTravailCensusManifest({
        ...franceTravailManifestInput,
        profileStrata: [{ email: "person@example.com", weight: 1 }],
      }),
    ).toThrow("unsafe France Travail profile strata");
  });

  test("executes only the pinned read-only observability query set", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const results = await runJobSupplyObservabilityQueries(
      {
        query: async (sql, parameters = []) => {
          calls.push({ sql, parameters });
          return [];
        },
      },
      {
        freshnessCutoff: "2026-07-13T00:00:00.000Z",
        coverageRunId: "00000000-0000-4000-8000-000000000001",
        freshnessWindowDays: 7,
        manifestDigest: "a".repeat(64),
      },
    );
    expect(assertReadOnlyObservabilityQueries()).toEqual([]);
    expect(Object.keys(results).sort()).toEqual([
      "atsHostCensus",
      "franceTravailPartitions",
      "paidUserCoverage",
      "providerConcentration",
      "routeQuality",
      "runCompleteness",
      "sourceInventory",
      "topology",
    ]);
    expect(calls).toHaveLength(8);
  });

  test("freezes a deterministic, cohort-weighted France Travail census manifest", () => {
    const manifest = freezeFranceTravailCensusManifest(franceTravailManifestInput);
    expect(manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(validateFranceTravailCensusManifest(manifest)).toEqual([]);
    expect(manifest.manifestDigest).toHaveLength(64);
    expect(stableDigest({ b: 2, a: 1 })).toBe(stableDigest({ a: 1, b: 2 }));

    const changed = structuredClone(manifest);
    changed.samplingSeed = "changed-after-results";
    expect(validateFranceTravailCensusManifest(changed)).toContain("manifest_digest_mismatch");

    const reordered = freezeFranceTravailCensusManifest({
      ...franceTravailManifestInput,
      profileStrata: [...franceTravailManifestInput.profileStrata].reverse(),
      partitions: [...franceTravailManifestInput.partitions].reverse(),
    });
    expect(reordered.manifestDigest).toBe(manifest.manifestDigest);
    expect(() =>
      freezeFranceTravailCensusManifest({
        ...franceTravailManifestInput,
        profileStrata: [{ email: "private@example.com", weight: 1 }],
      }),
    ).toThrow("unsafe France Travail profile strata");
  });

  test("rejects overlapping census windows for the same partition parameters", () => {
    const manifest = freezeFranceTravailCensusManifest({
      ...franceTravailManifestInput,
      partitions: [
        franceTravailManifestInput.partitions[0],
        {
          ...franceTravailManifestInput.partitions[1],
          publishedAfter: "2026-07-12T00:00:00.000Z",
        },
      ],
    });
    expect(
      validateFranceTravailCensusManifest(manifest).some((failure) =>
        failure.startsWith("overlapping_partition_windows:"),
      ),
    ).toBe(true);
  });

  test("excludes generatedAt from the immutable census decision digest", () => {
    const evidence = [
      {
        runId: "00000000-0000-0000-0000-000000000001",
        partitionId: "ft-window-1",
        status: "completed_with_results" as const,
        sourceReportedTotal: 2,
        fetchedRecords: 2,
        normalizedRecords: 2,
        rejectedRecords: 0,
        actionableRecords: 1,
        capHit: false,
      },
    ];
    const first = buildFranceTravailCensusManifest(evidence, "2026-07-20T00:00:00.000Z");
    const second = buildFranceTravailCensusManifest(evidence, "2026-07-21T00:00:00.000Z");
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.digest).toBe(second.digest);
  });

  test("does not claim a complete census without every source-reported total", () => {
    const manifest = buildFranceTravailCensusManifest(
      [
        {
          runId: "00000000-0000-0000-0000-000000000001",
          partitionId: "ft-window-1",
          status: "completed_zero_results",
          sourceReportedTotal: null,
          fetchedRecords: 0,
          normalizedRecords: 0,
          rejectedRecords: 0,
          actionableRecords: 0,
          capHit: false,
        },
      ],
      "2026-07-20T00:00:00.000Z",
    );

    expect(manifest.terminalState).toBe("blocked");
    expect(manifest.sourceReportedTotal).toBeNull();
  });

  test("reconciles the full France Travail census funnel and blocks unsafe terminal claims", () => {
    const accounting = {
      partitionId: "ft-1",
      status: "complete" as const,
      sourceReportedTotal: 10,
      httpRecords: 11,
      uniqueExternalIds: 10,
      duplicateRawRecords: 1,
      normalized: 9,
      rejectedNormalization: 1,
      occurrenceInserted: 3,
      occurrenceUpdated: 4,
      occurrenceDeduplicated: 2,
      writeFailed: 0,
      active: 8,
      actionable: 7,
      relevant: 6,
      namedResiduals: {},
    };
    expect(reconcileFranceTravailPartition(accounting)).toEqual([]);
    expect(
      reconcileFranceTravailPartition({
        ...accounting,
        status: "capped",
        blockerReason: undefined,
      }),
    ).toContain("capped_without_reason");
    expect(
      reconcileFranceTravailPartition({
        ...accounting,
        sourceReportedTotal: 11,
      }),
    ).toContain("source_total_accounting_mismatch");
  });

  test("pins every observability query as read-only and executes the complete bundle", async () => {
    expect(assertReadOnlyObservabilityQueries()).toEqual([]);
    expect(JOB_SUPPLY_OBSERVABILITY_QUERIES.atsHostCensus).toContain("regexp_replace");
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const results = await runJobSupplyObservabilityQueries(
      {
        async query(sql, parameters = []) {
          calls.push({ sql, parameters });
          return [];
        },
      },
      {
        freshnessCutoff: "2026-07-13T00:00:00.000Z",
        coverageRunId: "00000000-0000-0000-0000-000000000001",
        freshnessWindowDays: 7,
        manifestDigest: "a".repeat(64),
      },
    );
    expect(calls).toHaveLength(Object.keys(JOB_SUPPLY_OBSERVABILITY_QUERIES).length);
    expect(Object.keys(results).sort()).toEqual(
      Object.keys(JOB_SUPPLY_OBSERVABILITY_QUERIES).sort(),
    );
  });

  test("parses Content-Range totals and reconciles exact IDs over multiple pages", async () => {
    expect(parseContentRange("offres 0-149/1729")).toBe(1729);
    expect(parseContentRange("0-149/*")).toBeNull();
    const manifest = freezeFranceTravailCensusManifest({
      ...franceTravailManifestInput,
      capRules: { pageSize: 2, maxRecordsPerPartition: 10, maxRetries: 1 },
      partitions: [franceTravailManifestInput.partitions[0]],
    });
    const ranges: string[] = [];
    const result = await runFranceTravailLiveCensus(manifest, {
      accessToken: "secret-token",
      fetcher: async (input) => {
        const url = new URL(String(input));
        const range = url.searchParams.get("range");
        ranges.push(range);
        return range === "0-1"
          ? Response.json(
              { resultats: [{ id: "a" }, { id: "b" }] },
              {
                status: 206,
                headers: { "Content-Range": "offres 0-1/3" },
              },
            )
          : Response.json(
              { resultats: [{ id: "b" }, { id: "c" }] },
              {
                status: 200,
                headers: { "Content-Range": "offres 2-3/3" },
              },
            );
      },
      sleep: async () => {},
    });
    expect(ranges).toEqual(["0-1", "2-3"]);
    expect(result.partitions[0]).toMatchObject({
      status: "complete",
      sourceReportedTotal: 3,
      uniqueExternalIds: ["a", "b", "c"],
      duplicateRawRecords: 1,
      requests: 2,
    });
  });

  test("retries transient responses and marks cap pressure explicitly", async () => {
    const manifest = freezeFranceTravailCensusManifest({
      ...franceTravailManifestInput,
      capRules: { pageSize: 2, maxRecordsPerPartition: 2, maxRetries: 1 },
      partitions: [franceTravailManifestInput.partitions[0]],
    });
    let calls = 0;
    const result = await runFranceTravailLiveCensus(manifest, {
      accessToken: "secret-token",
      fetcher: async () => {
        calls += 1;
        if (calls === 1) return new Response("", { status: 429 });
        return Response.json(
          { resultats: [{ id: "a" }, { id: "b" }] },
          {
            status: 206,
            headers: { "Content-Range": "offres 0-1/5" },
          },
        );
      },
      sleep: async () => {},
    });
    expect(result.partitions[0]).toMatchObject({
      status: "capped",
      terminalReason: "source_total_exceeds_partition_cap",
      requests: 2,
      retries: 1,
    });
  });

  test("reports missing live credentials as an explicit external block without a secret", async () => {
    const manifest = freezeFranceTravailCensusManifest(franceTravailManifestInput);
    await expect(runFranceTravailLiveCensus(manifest)).rejects.toBeInstanceOf(
      ExternalDependencyBlockedError,
    );
    try {
      await runFranceTravailLiveCensus(manifest, { accessToken: "" });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).toContain("BLOCKED_EXTERNAL");
    }
  });
});
