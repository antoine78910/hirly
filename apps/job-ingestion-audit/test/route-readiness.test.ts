import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildOccurrencePreferenceDryRun,
  buildOccurrencePreferenceStructuralBlocker,
  buildRouteReadinessReport,
  buildSourceDiversificationGate,
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
      currentVerifiedRuntimeSelections: 0,
      verifiedRuntimeSelections: 1,
      verifiedRuntimeSelectionUplift: 1,
      currentDirectSelections: 0,
      directSelections: 1,
      directSelectionUplift: 1,
    });
    expect(JSON.stringify(report)).not.toContain("group-1");
    expect(JSON.stringify(report)).not.toContain("employer-ats");
  });

  test("records absent occurrence tables as typed non-scoreable evidence", () => {
    const input = JSON.parse(readFileSync(
      new URL(
        "../../../artifacts/job-ingestion/g018-occurrence-preference-blocked-2026-07-20.json",
        import.meta.url,
      ),
      "utf8",
    ));
    const { schemaVersion: _schemaVersion, scoreable: _scoreable,
      preferredDirectOccurrenceUplift: _uplift, unlockCondition: _unlock,
      safeguards: _safeguards, digest: _digest, ...builderInput } = input;
    const report = buildOccurrencePreferenceStructuralBlocker(builderInput);
    expect(report).toEqual(input);
    expect(report).toMatchObject({
      status: "BLOCKED_STRUCTURAL",
      scoreable: false,
      missingRelations: [
        "job_occurrences",
        "canonical_job_groups",
        "canonical_job_group_members",
      ],
      preferredDirectOccurrenceUplift: null,
      safeguards: {
        readOnly: true,
        aggregateOnly: true,
        canonicalWrites: false,
        applicationSubmissions: false,
        sourceActivationChanges: false,
        writerTransfer: false,
      },
    });
    expect(() => buildOccurrencePreferenceStructuralBlocker({
      ...builderInput,
      missingRelations: [],
    })).toThrow("requires at least one missing relation");
  });

  test("gates aggregate source diversification without activating sources", () => {
    const report = buildSourceDiversificationGate({
      status: "COMPLETE",
      sample: false,
      generatedAt: "2026-07-20T19:00:00.000Z",
      routeReadinessDigest: "a".repeat(64),
      netNewMeasurementDigest: "b".repeat(64),
      current: {
        runtimeReadyJobs: 2_000,
        franceTravailRuntimeReadyJobs: 800,
        topProviderRuntimeReadyJobs: 1_000,
        evaluatedPaidUsers: 100,
        exhaustedPaidUsers: 20,
        p10: 1,
        p50: 5,
        p90: 20,
      },
      projected: {
        runtimeReadyJobs: 3_000,
        franceTravailRuntimeReadyJobs: 800,
        topProviderRuntimeReadyJobs: 1_100,
        evaluatedPaidUsers: 100,
        exhaustedPaidUsers: 10,
        p10: 3,
        p50: 8,
        p90: 30,
      },
      proposedSources: [
        {
          sourceKey: "bpce-open-feed",
          incrementalRuntimeReadyJobs: 600,
          affectedPaidUsers: 70,
        },
        {
          sourceKey: "greenhouse-authorized-tenants",
          incrementalRuntimeReadyJobs: 400,
          affectedPaidUsers: 50,
        },
      ],
      thresholds: {
        minRuntimeReadyUplift: 500,
        maxFranceTravailShare: 0.3,
        maxTopProviderShare: 0.4,
        maxFeedExhaustionRate: 0.15,
        minP10: 2,
      },
    });
    expect(report).toMatchObject({
      status: "GO",
      runtimeReadyUplift: 1_000,
      franceTravailShareDelta: -0.13333333,
      failedGates: [],
      safeguards: {
        aggregateOnly: true,
        applicationSubmissions: false,
        sourceActivationChanges: false,
        canonicalWrites: false,
      },
    });
    expect(report.current.franceTravailShare).toBe(0.4);
    expect(report.projected.franceTravailShare).toBe(0.26666667);
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("fails closed on blocked, unreconciled, or regressing diversification evidence", () => {
    const base = {
      status: "COMPLETE" as const,
      sample: false,
      generatedAt: "2026-07-20T19:00:00.000Z",
      routeReadinessDigest: "a".repeat(64),
      netNewMeasurementDigest: "b".repeat(64),
      current: {
        runtimeReadyJobs: 100,
        franceTravailRuntimeReadyJobs: 60,
        topProviderRuntimeReadyJobs: 60,
        evaluatedPaidUsers: 10,
        exhaustedPaidUsers: 2,
        p10: 1,
        p50: 3,
        p90: 8,
      },
      projected: {
        runtimeReadyJobs: 110,
        franceTravailRuntimeReadyJobs: 60,
        topProviderRuntimeReadyJobs: 60,
        evaluatedPaidUsers: 10,
        exhaustedPaidUsers: 3,
        p10: 0,
        p50: 2,
        p90: 7,
      },
      proposedSources: [{
        sourceKey: "bpce-open-feed",
        incrementalRuntimeReadyJobs: 10,
        affectedPaidUsers: 5,
      }],
      thresholds: {
        minRuntimeReadyUplift: 20,
        maxFranceTravailShare: 0.5,
        maxTopProviderShare: 0.5,
        maxFeedExhaustionRate: 0.2,
        minP10: 1,
      },
    };
    const noGo = buildSourceDiversificationGate(base);
    expect(noGo.status).toBe("NO_GO");
    expect(noGo.failedGates).toEqual([
      "runtime_ready_uplift_below_minimum",
      "france_travail_concentration_not_reduced",
      "top_provider_concentration_above_maximum",
      "feed_exhaustion_above_maximum",
      "paid_user_p10_below_minimum",
      "paid_user_coverage_regressed",
    ]);
    expect(() => buildSourceDiversificationGate({
      ...base,
      status: "BLOCKED_EXTERNAL",
      blockerReason: "paid cohort unavailable",
    })).toThrow("not scoreable");
    expect(() => buildSourceDiversificationGate({
      ...base,
      proposedSources: [{
        sourceKey: "bpce-open-feed",
        incrementalRuntimeReadyJobs: 9,
        affectedPaidUsers: 5,
      }],
    })).toThrow("does not reconcile");
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
    expect(sql).toContain("'paid_user_role_cohort_unavailable'");
    expect(sql).toContain("'BLOCKED_EXTERNAL'");
    expect(sql).toContain("'{billing,subscription_status}'");
    expect(sql).toContain("percentile_disc(0.1)");
    expect(sql).toContain("percentile_disc(0.5)");
    expect(sql).toContain("percentile_disc(0.9)");
    expect(sql).not.toContain("'userId'");
    expect(sql).not.toMatch(/jsonb_agg\s*\(/i);

  });
});
