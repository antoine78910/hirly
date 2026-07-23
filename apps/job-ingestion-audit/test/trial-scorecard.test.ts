import { describe, expect, test } from "bun:test";
import baselineFixture from "../fixtures/trial-scorecard-baseline.json";
import snapshotsFixture from "../fixtures/trial-scorecard-snapshots.json";
import { buildTrialScorecard } from "../src/trial-scorecard";

const clone = <T>(value: T): T => structuredClone(value);

describe("trial scorecard", () => {
  test("computes exact layered-dedup fixture math", () => {
    const report = buildTrialScorecard(baselineFixture, snapshotsFixture);
    expect(report).toEqual({
      schemaVersion: 1,
      status: "COMPLETE",
      cohortId: "paid-fr",
      runs: 2,
      providers: [
        {
          provider: "greenhouse",
          tenant: "acme",
          primaryMetric: 1,
          jobsPerPaidUser: { p10: 0, p50: 1, p90: 1 },
          feedExhaustionRate: 0.375,
          canonicalApplyUrlRate: 1,
          knownApplicationRouteRate: 0.666667,
          duplicateRate: 0.2,
          unavailableRate: 0.2,
          affectedUsers: 3,
          sourceConcentration: 0.6,
          uniqueActionableJobs: 3,
        },
        {
          provider: "lever",
          tenant: "beta",
          primaryMetric: 0,
          jobsPerPaidUser: { p10: 0, p50: 0, p90: 1 },
          feedExhaustionRate: 0.75,
          canonicalApplyUrlRate: 0.5,
          knownApplicationRouteRate: 1,
          duplicateRate: 0,
          unavailableRate: 0,
          affectedUsers: 2,
          sourceConcentration: 0.4,
          uniqueActionableJobs: 2,
        },
      ],
      reconciliation: [
        {
          fromSnapshotId: "run-1",
          toSnapshotId: "run-2",
          additions: ["group:c", "group:d"],
          removals: ["group:b", "group:x"],
        },
      ],
      requestCost: {
        expectedRequests: 4,
        actualRequests: 4,
        requestsMatch: true,
        expectedCostMinor: 30,
        actualCostMinor: 30,
        costMatch: true,
      },
      digest: report.digest,
    });
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("has a reorder-stable digest and output", () => {
    const baseline = clone(baselineFixture);
    baseline.paidUserIds.reverse();
    baseline.currentJobs.reverse();
    const snapshots = clone(snapshotsFixture).reverse();
    for (const snapshot of snapshots) {
      snapshot.jobs.reverse();
      for (const job of snapshot.jobs) job.matchedUserIds.reverse();
    }
    expect(buildTrialScorecard(baseline, snapshots)).toEqual(
      buildTrialScorecard(baselineFixture, snapshotsFixture),
    );
  });

  const refusalCases: Array<
    [string, { baseline?: Record<string, unknown>; snapshot?: Record<string, unknown> }]
  > = [
    ["sample baseline", { baseline: { sample: true } }],
    ["blocked baseline", { baseline: { status: "BLOCKED_EXTERNAL" } }],
    ["missing policy digest", { baseline: { policyDigest: "" } }],
    ["missing control digest", { baseline: { controlDigest: "" } }],
    ["partial snapshot", { snapshot: { complete: false } }],
    ["blocked snapshot", { snapshot: { status: "BLOCKED_EXTERNAL" } }],
    ["sample snapshot", { snapshot: { sample: true } }],
    ["zero-volume complete snapshot", { snapshot: { jobs: [] } }],
    ["mismatched control", { snapshot: { controlDigest: "other" } }],
  ];

  test.each(refusalCases)("fails closed for %s", (_name, mutation) => {
    const baseline = clone(baselineFixture) as Record<string, unknown>;
    const snapshots = clone(snapshotsFixture) as Array<Record<string, unknown>>;
    Object.assign(baseline, mutation.baseline ?? {});
    Object.assign(snapshots[0], mutation.snapshot ?? {});
    expect(() => buildTrialScorecard(baseline, snapshots)).toThrow("TRIAL_SCORECARD_REFUSED");
  });

  test("refuses zero runs and malformed inputs", () => {
    expect(() => buildTrialScorecard(baselineFixture, [])).toThrow("at least one run");
    expect(() => buildTrialScorecard({}, snapshotsFixture)).toThrow("schemaVersion");
    const snapshots = clone(snapshotsFixture);
    snapshots[0]?.jobs[0].matchedUserIds = ["outside-cohort"];
    expect(() => buildTrialScorecard(baselineFixture, snapshots)).toThrow("outside the cohort");
  });

  test("reports request and cost mismatch without concealing it", () => {
    const baseline = clone(baselineFixture);
    baseline.expectedRequests = 99;
    baseline.expectedCostMinor = 99;
    expect(buildTrialScorecard(baseline, snapshotsFixture).requestCost).toMatchObject({
      requestsMatch: false,
      costMatch: false,
    });
  });
});
