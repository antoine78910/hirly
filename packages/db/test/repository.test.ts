import { describe, expect, test } from "bun:test";
import { type Database, WorkerRepository } from "../src";

describe("database repository boundary", () => {
  test("exports only named operations, not arbitrary state mutation", () => {
    const methods = Object.getOwnPropertyNames(WorkerRepository.prototype);
    expect(methods).toContain("claim");
    expect(methods).toContain("heartbeat");
    expect(methods).toContain("finish");
    expect(methods).toContain("writeJobAndComplete");
    expect(methods).not.toContain("updateTask");
    expect(methods).not.toContain("query");
  });

  test("registers a validated disabled career source through the private RPC", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const tag = ((
      strings: TemplateStringsArray,
      ...parameters: unknown[]
    ) => {
      statements.push(strings.join("?"));
      values.push(parameters);
      return Promise.resolve([
        {
          id: "11111111-1111-4111-8111-111111111111",
          provider: "greenhouse",
          source_key: "greenhouse:hirly",
          tenant_key: "hirly",
          company_id: null,
          company_name: "Hirly",
          country_codes: ["FR"],
          base_url: "https://boards.greenhouse.io/hirly",
          access_type: "tenant_feed",
          policy_id: null,
          sync_frequency_seconds: 3600,
          checkpoint: { version: "ats-discovery.v1" },
          last_attempt_at: null,
          last_success_at: null,
          last_complete_run_id: null,
          consecutive_failures: 0,
          enabled: false,
          transport_enabled: false,
          incremental_enabled: false,
          backfill_enabled: false,
          discovery_state: "candidate",
        },
      ]);
    }) as unknown as Database;
    tag.json = (value) => value as never;

    const candidate = await new WorkerRepository(
      tag,
    ).registerCareerSourceCandidate({
      provider: "greenhouse",
      sourceKey: "greenhouse:hirly",
      tenantKey: "hirly",
      companyId: null,
      companyName: "Hirly",
      countryCodes: ["FR"],
      baseUrl: "https://boards.greenhouse.io/hirly",
      accessType: "tenant_feed",
      policyId: null,
      syncFrequencySeconds: 3600,
      checkpoint: { version: "ats-discovery.v1" },
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      "worker_private.register_career_source_candidate",
    );
    expect(values[0]?.slice(0, 3)).toEqual([
      "greenhouse",
      "greenhouse:hirly",
      "hirly",
    ]);
    expect(candidate).toMatchObject({
      provider: "greenhouse",
      tenantKey: "hirly",
      enabled: false,
      transportEnabled: false,
      incrementalEnabled: false,
      backfillEnabled: false,
      discoveryState: "candidate",
    });
  });
});
