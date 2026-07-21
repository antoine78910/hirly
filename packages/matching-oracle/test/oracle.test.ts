import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/paris-fullstack.json";
import { MatchingOracle, ONLINE_MATCH_EXPLAIN_SQL, queryPlanEvidence } from "../src";
import type { CandidateAction, CandidateSearchProfile, JobSearchDocument } from "../src";

const profile = fixture.profile as CandidateSearchProfile;
const jobs = fixture.jobs as JobSearchDocument[];
const actions = fixture.actions as CandidateAction[];
const now = new Date("2026-07-21T00:00:00Z");

describe("PR0 deterministic online matching oracle", () => {
  test("returns the eligible Paris Fullstack job without excluding manual fulfillment", () => {
    const result = new MatchingOracle(jobs).match(profile, actions, { now });
    expect(result).toEqual({
      coarseCandidateCount: 1,
      eligibleCount: 1,
      hiddenCount: 3,
      results: [{
        canonicalGroupId: "group-best",
        preferredJobId: "job-best",
        jobVersion: "v1",
        matcherVersion: "matching-oracle.v1",
        relevanceScore: 99.166667,
        fulfillmentRoute: "manual",
        explanationCodes: [
          "role_family_overlap",
          "skill_overlap",
          "location_work_mode_match",
          "contract_match",
          "fresh_listing",
        ],
      }],
    });
  });

  test("is input-order invariant and uses canonical group as a stable tie breaker", () => {
    const duplicateScore = { ...jobs[0]!, canonicalGroupId: "group-alpha", preferredJobId: "job-alpha" };
    const forward = new MatchingOracle([jobs[0]!, duplicateScore]).match(profile, [], { now });
    const reverse = new MatchingOracle([duplicateScore, jobs[0]!]).match(profile, [], { now });
    expect(reverse).toEqual(forward);
    expect(forward.results.map((result) => result.canonicalGroupId)).toEqual(["group-alpha", "group-best"]);
  });

  test("applies hard constraints before the coarse bound", () => {
    const wrongCountry = Array.from({ length: 1_001 }, (_, index) => ({
      ...jobs[0]!,
      canonicalGroupId: `a-wrong-${String(index).padStart(4, "0")}`,
      preferredJobId: `wrong-${index}`,
      countryCode: "US",
    }));
    const result = new MatchingOracle([...wrongCountry, jobs[0]!]).match(profile, [], { now });
    expect(result.results[0]?.canonicalGroupId).toBe("group-best");
    expect(result.coarseCandidateCount).toBe(1);
  });

  test("rejects duplicate canonical groups and unbounded configurations", () => {
    expect(() => new MatchingOracle([jobs[0]!, jobs[0]!])).toThrow("duplicate canonical group");
    expect(() => new MatchingOracle([{ ...jobs[0]!, publishedAt: "not-a-date" }])).toThrow("invalid publishedAt");
    expect(() => new MatchingOracle([{ ...jobs[0]!, qualityScore: 101 }])).toThrow("invalid qualityScore");
    expect(() => new MatchingOracle(jobs).match(profile, [], {
      now,
      config: {
        matcherVersion: "invalid",
        coarseLimit: 10_001,
        resultLimit: 200,
        weights: { role: 35, skills: 20, geographyAndWorkMode: 20, contract: 10, freshness: 10, quality: 5 },
      },
    })).toThrow("coarseLimit");
  });

  test("publishes a bounded, action-aware SQL EXPLAIN contract without a cartesian join", () => {
    expect(ONLINE_MATCH_EXPLAIN_SQL).toContain("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)");
    expect(ONLINE_MATCH_EXPLAIN_SQL).toContain("LIMIT 1000");
    expect(ONLINE_MATCH_EXPLAIN_SQL).toContain("NOT EXISTS");
    expect(ONLINE_MATCH_EXPLAIN_SQL).not.toMatch(/CROSS\s+JOIN/i);
    expect(queryPlanEvidence().databaseEvidence).toBe("not_collected");
  });
});
