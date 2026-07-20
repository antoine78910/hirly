import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ATS_RANKING_QUERIES,
  assertReadOnlyAtsRankingQueries,
  rankAtsCandidates,
  runAtsRankingQueries,
} from "../src/ats-ranking";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/ats-ranking-input.json", import.meta.url),
    "utf8",
  ),
);

describe("G011 measured ATS ranking", () => {
  test("keeps fixture evidence externally blocked and never preselects a connector", () => {
    const report = rankAtsCandidates(fixture);
    expect(report.status).toBe("BLOCKED_EXTERNAL");
    expect(report.sampleEvidence).toBe(true);
    expect(report.connectorChoice).toBeNull();
    expect(report.ranking.map((row) => row.provider)).toEqual([
      "greenhouse",
      "nicoka",
    ]);
    expect(report.ranking[0]?.allSourcesDisabled).toBe(true);
    expect(report.ranking[0]?.requestCostMinorPerIncrementalGroup).toBeNull();
  });

  test("ranks cohort-weighted incremental impact per reviewed delivery cost", () => {
    const report = rankAtsCandidates({
      ...fixture,
      status: "COMPLETE",
      sampleEvidence: false,
      requestCosts: [
        {
          provider: "greenhouse",
          requestCostMinor: 40,
          requestCostCurrency: "EUR",
        },
        {
          provider: "nicoka",
          requestCostMinor: 15,
          requestCostCurrency: "EUR",
        },
      ],
      policy: fixture.policy.map((row: Record<string, unknown>) => ({
        ...row,
        anyProductionEligible: row.provider === "nicoka",
      })),
    });
    expect(report.ranking[0]?.provider).toBe("greenhouse");
    expect(report.ranking[0]?.paidUserGroupImpactsPerDeliveryPoint).toBe(9 / 7);
    expect(report.connectorChoice).toBe("nicoka");
  });

  test("classifies host inventory with the shared ATS classifier", () => {
    const report = rankAtsCandidates({
      ...fixture,
      hostInventory: [
        {
          applyHost: "tenant.jobs.personio.de",
          recordedProvider: "unknown",
          jobs: 2,
          companies: 1,
          franceJobs: 2,
          validJobs: 2,
        },
      ],
    });
    expect(report.ranking.find((row) => row.provider === "personio")).toMatchObject({
      jobs: 2,
      franceJobs: 2,
    });
  });

  test("executes only pinned read-only queries against repository tables", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const result = await runAtsRankingQueries(
      {
        async query(sql, parameters = []) {
          calls.push({ sql, parameters });
          return [];
        },
      },
      {
        coverageRunId: "00000000-0000-4000-8000-000000000001",
        costWindowStart: "2026-07-01T00:00:00.000Z",
        costWindowEnd: "2026-08-01T00:00:00.000Z",
      },
    );
    expect(assertReadOnlyAtsRankingQueries()).toEqual([]);
    expect(calls).toHaveLength(4);
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(ATS_RANKING_QUERIES).sort(),
    );
    expect(ATS_RANKING_QUERIES.paidUserImpact).toContain(
      "paid_user_source_contributions",
    );
    expect(ATS_RANKING_QUERIES.requestCost).toContain("request_cost_minor");
  });

  test("rejects negative or non-finite measurements", () => {
    expect(() =>
      rankAtsCandidates({
        ...fixture,
        hostInventory: [
          {
            ...fixture.hostInventory[0],
            jobs: -1,
          },
        ],
      }),
    ).toThrow("jobs_must_be_finite_non_negative");
  });
});
