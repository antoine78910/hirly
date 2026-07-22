import { describe, expect, test } from "bun:test";
import { parseClientConfig, parseWorkerConfig } from "../src";

const databaseUrl = "postgresql://worker:secret@localhost:5432/inventory";

describe("server configuration", () => {
  test("fails without the direct inventory database URL", () => {
    expect(() => parseWorkerConfig({})).toThrow();
  });

  test("fails closed when control is enabled without a token", () => {
    expect(() =>
      parseWorkerConfig({
        JOBS_DATABASE_URL: databaseUrl,
        WORKER_CONTROL_ENABLED: "true",
      }),
    ).toThrow();
  });

  test("rejects heartbeat intervals that cannot preserve the lease", () => {
    expect(() =>
      parseWorkerConfig({
        JOBS_DATABASE_URL: databaseUrl,
        WORKER_LEASE_SECONDS: "10",
        WORKER_HEARTBEAT_SECONDS: "10",
      }),
    ).toThrow();
  });

  test("client config cannot expose server credentials", () => {
    expect(() => parseClientConfig({ NEXT_PUBLIC_JOBS_DATABASE_URL: databaseUrl })).toThrow();
    expect(parseClientConfig({ JOBS_DATABASE_URL: databaseUrl })).toEqual({});
  });

  test("accepts a complete process environment without weakening schema strictness", () => {
    expect(
      parseWorkerConfig({
        PATH: "/usr/bin",
        HOME: "/tmp",
        JOBS_DATABASE_URL: databaseUrl,
      }).JOBS_DATABASE_URL,
    ).toBe(databaseUrl);
  });
});
