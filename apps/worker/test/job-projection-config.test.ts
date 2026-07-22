import { describe, expect, test } from "bun:test";
import { parseRuntimeConfig } from "../src/runtime/config";

const base = {
  NODE_ENV: "test",
  JOBS_DATABASE_URL: "postgresql://worker:test@localhost:5432/hirly",
};

describe("job projection runtime configuration", () => {
  test("keeps projection and reconciliation disabled by default", () => {
    const config = parseRuntimeConfig(base);
    expect(config.JOB_PROJECTION_ENABLED).toBe(false);
    expect(config.PROJECTION_RECONCILIATION_ENABLED).toBe(false);
    expect(config.JOB_PROJECTION_BATCH_SIZE).toBe(10);
    expect(config.JOB_PROJECTION_RECONCILIATION_BATCH_SIZE).toBe(100);
  });

  test("rejects ambiguous rollout flag values", () => {
    expect(() => parseRuntimeConfig({ ...base, JOB_PROJECTION_ENABLED: "yes" })).toThrow();
  });
});
