import { describe, expect, test } from "bun:test";
import { evaluatePartition, reconcileFunnel, validateRows } from "../src/audit";
import { readFileSync } from "node:fs";

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
    })).toEqual(["repeated_cursor", "cap_hit_marked_complete"]);
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
});
