import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildNetNewMeasurement,
  type NetNewMeasurementInput,
} from "../src/net-new-measurement";

const input: NetNewMeasurementInput = {
  status: "COMPLETE",
  sample: false,
  generatedAt: "2026-07-20T14:00:00.000Z",
  freshnessCutoff: "2026-06-20T14:00:00.000Z",
  coverageRunId: "coverage-1",
  trialRunIds: ["trial-1", "trial-2"],
  baseline: {
    layeredUniqueJobs: 100,
    fresh30dUniqueJobs: 90,
    autoApplicableUniqueJobs: 20,
    franceTravailUniqueJobs: 70,
    franceTravailAutoApplicableJobs: 10,
  },
  sources: [
    {
      provider: "greenhouse",
      tenant: "acme",
      observedCandidates: 20,
      exactOccurrenceDuplicates: 2,
      canonicalUrlDuplicates: 3,
      atsIdentityDuplicates: 1,
      fingerprintDuplicates: 4,
      incrementalNetNew: 10,
      incrementalFreshRelevantActionable: 8,
      incrementalAutoApplicable: 6,
      paidUserJobMatches: 15,
    },
    {
      provider: "taleez",
      tenant: "beta",
      observedCandidates: 10,
      exactOccurrenceDuplicates: 1,
      canonicalUrlDuplicates: 1,
      atsIdentityDuplicates: 0,
      fingerprintDuplicates: 1,
      incrementalNetNew: 7,
      incrementalFreshRelevantActionable: 5,
      incrementalAutoApplicable: 4,
      paidUserJobMatches: 9,
    },
  ],
};

describe("G016 aggregate net-new inventory measurement", () => {
  test("reports reconciled net-new, auto-applicable and France Travail concentration uplift", () => {
    const report = buildNetNewMeasurement(input);
    expect(report.uplift).toMatchObject({
      incrementalNetNew: 17,
      incrementalFreshRelevantActionable: 13,
      incrementalAutoApplicable: 10,
      paidUserJobMatches: 24,
      projectedLayeredUniqueJobs: 117,
      projectedAutoApplicableUniqueJobs: 30,
    });
    expect(report.baseline.franceTravailConcentration).toBe(0.7);
    expect(report.uplift.projectedFranceTravailConcentration).toBe(0.5982906);
    expect(report.uplift.franceTravailConcentrationDelta).toBe(-0.1017094);
    expect(report.sources[0]).toMatchObject({
      duplicateTotal: 10,
      duplicateRate: 0.5,
      netNewRate: 0.5,
    });
    expect(report.trialRunDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(buildNetNewMeasurement({
      ...input,
      trialRunIds: [...input.trialRunIds].reverse(),
      sources: [...input.sources].reverse(),
    }).digest).toBe(report.digest);
  });

  test("refuses sample, blocked and unreconciled evidence", () => {
    expect(() => buildNetNewMeasurement({ ...input, sample: true }))
      .toThrow("sample evidence is not scoreable");
    expect(() => buildNetNewMeasurement({
      ...input,
      status: "BLOCKED_EXTERNAL",
      blockerReason: "coverage database unavailable",
    })).toThrow("not scoreable");
    expect(() => buildNetNewMeasurement({
      ...input,
      sources: [{ ...input.sources[0]!, incrementalNetNew: 9 }],
    })).toThrow("layered dedup accounting does not reconcile");
  });

  test("pins the operator SQL to aggregate-only read-only output", () => {
    const sql = readFileSync(
      new URL("../../../docs/operations/sql/multi-source-net-new-measurement.sql", import.meta.url),
      "utf8",
    );
    const normalized = sql.replace(/--.*$/gm, " ").toLowerCase();
    expect(normalized.trimStart().startsWith("\\set")).toBe(true);
    expect(normalized).not.toMatch(/\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke)\b/);
    expect(sql).toContain("'exact_occurrence'");
    expect(sql).toContain("'canonical_url'");
    expect(sql).toContain("'ats_identity'");
    expect(sql).toContain("'fingerprint'");
    expect(sql).toContain("paid_user_source_contributions");
    expect(sql).toContain("franceTravailUniqueJobs");
    expect(sql).toContain("incrementalAutoApplicable");
    expect(sql).not.toMatch(/jsonb_agg\s*\(\s*(candidate|payload|data|hashed_user_id)/i);
  });
});
