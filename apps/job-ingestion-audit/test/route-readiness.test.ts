import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildOccurrencePreferenceDryRun,
  buildRouteReadinessReport,
  routeFailureReasons,
  type RouteReadinessAggregateInput,
} from "../src/route-readiness";

const input: RouteReadinessAggregateInput = {
  status: "COMPLETE",
  sample: false,
  generatedAt: "2026-07-20T18:00:00.000Z",
  freshnessCutoff: "2026-06-20T18:00:00.000Z",
  queryVersion: "g018-route-readiness-v1",
  layeredFrenchJobs: 100,
  actionableJobs: 60,
  staticAutoApplicable: 30,
  runtimeReadyAutoApplicable: 20,
  franceTravailRuntimeReady: 8,
  topProviderRuntimeReady: 10,
  failureBuckets: Object.fromEntries(
    routeFailureReasons.map((reason, index) => [reason, index === 0 ? 80 : 0]),
  ) as RouteReadinessAggregateInput["failureBuckets"],
  paidUserCoverage: {
    evaluatedPaidUsers: 10,
    exhaustedPaidUsers: 2,
    p10: 0,
    p50: 4,
    p90: 12,
  },
};

describe("G018 route-readiness evidence", () => {
  test("separates optimistic ATS detection from runtime-ready inventory", () => {
    const report = buildRouteReadinessReport(input);
    expect(report.optimisticOverclaim).toBe(10);
    expect(report.autoApplicableRate).toBe(0.2);
    expect(report.feedExhaustionRate).toBe(0.2);
    expect(report.franceTravailRuntimeReadyShare).toBe(0.4);
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("refuses sample, blocked, overlapping and unreconciled evidence", () => {
    expect(() => buildRouteReadinessReport({ ...input, sample: true }))
      .toThrow("sample evidence is not scoreable");
    expect(() => buildRouteReadinessReport({
      ...input,
      status: "BLOCKED_EXTERNAL",
      blockerReason: "coverage unavailable",
    })).toThrow("not scoreable");
    expect(() => buildRouteReadinessReport({
      ...input,
      runtimeReadyAutoApplicable: 31,
    })).toThrow("strict-auto <= static-auto");
    expect(() => buildRouteReadinessReport({
      ...input,
      failureBuckets: { ...input.failureBuckets, missing_url: 79 },
    })).toThrow("do not reconcile");
  });

  test("dry-runs direct occurrence preference without exposing selections", () => {
    const report = buildOccurrencePreferenceDryRun([
      {
        groupKey: "group-1",
        occurrenceKey: "france-travail",
        active: true,
        authority: "official_public",
        route: "manual_public",
        confidence: 0.9,
      },
      {
        groupKey: "group-1",
        occurrenceKey: "employer-ats",
        active: true,
        authority: "direct_employer",
        route: "verified_runtime_ats",
        confidence: 0.8,
        verifiedAt: "2026-07-20T17:00:00.000Z",
      },
      {
        groupKey: "group-2",
        occurrenceKey: "aggregator",
        active: true,
        authority: "aggregator",
        route: "discovery_only",
        confidence: 0.9,
      },
    ], {
      "group-1": "france-travail",
      "group-2": "aggregator",
    });
    expect(report).toMatchObject({
      groupsEvaluated: 2,
      groupsWithSelection: 2,
      selectionsChanged: 1,
      verifiedRuntimeSelections: 1,
      directSelections: 1,
    });
    expect(JSON.stringify(report)).not.toContain("group-1");
    expect(JSON.stringify(report)).not.toContain("employer-ats");
  });

  test("pins the production census to aggregate-only read-only SQL", () => {
    const sql = readFileSync(
      new URL(
        "../../../docs/operations/sql/french-route-readiness-census.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const normalized = sql.replace(/--.*$/gm, " ").toLowerCase();
    expect(normalized.trimStart().startsWith("\\set")).toBe(true);
    expect(normalized).not.toMatch(
      /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke)\b/,
    );
    expect(sql).toContain("'known_ats_without_runtime_driver'");
    expect(sql).toContain("'paid_user_auto_applicable_coverage_not_yet_measured'");
    expect(sql).toContain("'BLOCKED_EXTERNAL'");
    expect(sql).not.toMatch(/jsonb_agg\s*\(/i);
  });
});
