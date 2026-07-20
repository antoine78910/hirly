import { describe, expect, test } from "bun:test";
import contractRegistry from "../packages/contracts/src/analytics-registry.v1.json";
import { analyticsRegistry as frontendRegistry } from "../frontend/src/lib/analyticsRegistry.generated";

describe("frontend analytics registry adapter", () => {
  test("is generated exactly from the shared contract registry", () => {
    expect(frontendRegistry).toEqual(contractRegistry);
  });
});
