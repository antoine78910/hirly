import { describe, expect, test } from "bun:test";
import contractRegistry from "../packages/contracts/src/analytics-registry.v1.json";
import { analyticsRegistry as frontendRegistry } from "../frontend/src/lib/analyticsRegistry.generated";

describe("frontend analytics registry adapter", () => {
  test("is generated exactly from the shared contract registry", () => {
    expect(frontendRegistry).toEqual(contractRegistry);
  });

  test("contains only the governed backend paid-lifecycle event definitions", () => {
    for (const name of ["subscription_activated", "subscription_churned"] as const) {
      const definitions = contractRegistry.events.filter((event) => event.name === name);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        authoritativeSource: "backend",
        identityPolicy: "identified",
        canonicalTimeQualities: ["exact_business_timestamp"],
      });
    }
    expect(
      contractRegistry.events.find((event) => event.name === "subscription_churned"),
    ).toMatchObject({
      semanticDeduplicationKey: "subscription_id:generation",
      requiredProperties: {
        generation: { type: "integer", privacy: "public", minimum: 1 },
      },
    });
  });
});
