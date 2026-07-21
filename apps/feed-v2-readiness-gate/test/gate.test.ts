import { describe, expect, test } from "bun:test";
import { evaluateFeedV2Readiness } from "../src/gate";

const ready = (radiusKm = 52) => ({
  delegationEnabled: true,
  internalUrl: "http://feed-v2.internal/internal/feed/v2",
  assertionSecretLength: 32,
  cohortUserIds: ["candidate-1"],
  smokeCandidateId: "candidate-1",
  sloMs: 1_500,
  health: { status: "live", routingEnabled: true, latencyMs: 12 },
  publicSmoke: {
    role: "Fullstack Engineer",
    location: "Paris, France",
    radiusKm,
    latencyMs: 120,
    status: 200,
    body: { contractVersion: "hirly.feed.v2", jobs: [{ id: "job-1" }] },
  },
});

describe("Feed v2 deployment readiness gate", () => {
  test("fails closed without evidence", () => {
    expect(evaluateFeedV2Readiness().deploymentStatus).toBe("NOT_READY");
  });

  test("accepts generic 52km and 103km explicit query fixtures", () => {
    expect(evaluateFeedV2Readiness(ready(52)).deploymentStatus).toBe("READY");
    expect(evaluateFeedV2Readiness(ready(103)).deploymentStatus).toBe("READY");
  });

  test("rejects legacy GET and any provider or background side effect", () => {
    const evidence = evaluateFeedV2Readiness({
      ...ready(),
      publicSmoke: {
        ...ready().publicSmoke,
        body: {
          jobs: [],
          feed_mode: "legacy_jsearch_only",
          total_count: 10,
          refresh_results: [{ attempted: true }],
        },
      },
    });
    expect(evidence.unmetReasons).toContain("smoke:legacy_jsearch_only");
    expect(evidence.unmetReasons).toContain("smoke:get_side_effect_detected");
    expect(evidence.unmetReasons).toContain("smoke:empty_despite_fetched_inventory");
  });

  test("separates configuration readiness from a missing public smoke", () => {
    const { publicSmoke: _, ...configuration } = ready();
    const evidence = evaluateFeedV2Readiness(configuration);
    expect(evidence.configurationStatus).toBe("READY");
    expect(evidence.deploymentStatus).toBe("NOT_READY");
    expect(evidence.unmetReasons).toEqual(["smoke:not_supplied"]);
  });

  test("never includes assertion secrets or authorization tokens in evidence", () => {
    const evidence = JSON.stringify(evaluateFeedV2Readiness(ready()));
    expect(evidence).not.toContain("secret");
    expect(evidence).not.toContain("authorization");
  });
});
