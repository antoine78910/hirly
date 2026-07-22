import { describe, expect, test } from "bun:test";
import { parseCandidateProjectionRuntimeConfig } from "../src/candidate-projection/config";

describe("candidate projection runtime", () => {
  test("stays disabled without opening a primary database", () => {
    expect(parseCandidateProjectionRuntimeConfig({})).toEqual({
      enabled: false,
      primaryDatabaseUrl: undefined,
      pollMs: 1000,
      batchSize: 50,
      leaseSeconds: 120,
    });
  });

  test("requires an explicit primary database when enabled", () => {
    expect(() =>
      parseCandidateProjectionRuntimeConfig({
        CANDIDATE_PROJECTION_RELAY_ENABLED: "true",
      }),
    ).toThrow("primary database URL is required");
    expect(
      parseCandidateProjectionRuntimeConfig({
        CANDIDATE_PROJECTION_RELAY_ENABLED: "true",
        CANDIDATE_PROJECTION_PRIMARY_DATABASE_URL: "postgresql://localhost/primary",
      }).enabled,
    ).toBe(true);
  });
});
