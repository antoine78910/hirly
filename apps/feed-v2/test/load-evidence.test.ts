import { describe, expect, test } from "bun:test";
import { DEFAULT_BASELINE_CONCURRENCY, percentile, planFacts } from "../src/load-evidence";

describe("Feed v2 load evidence helpers", () => {
  test("computes nearest-rank percentiles deterministically", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.99)).toBe(5);
  });

  test("uses the fixed logical baseline that exercises peak-32", () => {
    expect(DEFAULT_BASELINE_CONCURRENCY).toBe(16);
    expect(DEFAULT_BASELINE_CONCURRENCY * 2).toBe(32);
  });

  test("collects plan nodes and indexes for serving-path assertions", () => {
    expect(
      planFacts([
        {
          Plan: {
            "Node Type": "Index Scan",
            "Index Name": "feed_idx",
            "Shared Hit Blocks": 4,
            "Shared Read Blocks": 2,
            Plans: [
              {
                "Node Type": "Bitmap Index Scan",
                "Index Name": "features_idx",
                "Shared Hit Blocks": 3,
              },
            ],
          },
        },
      ]),
    ).toEqual({
      nodeTypes: ["Bitmap Index Scan", "Index Scan"],
      indexNames: ["features_idx", "feed_idx"],
      sharedHitBlocks: 7,
      sharedReadBlocks: 2,
    });
  });
});
