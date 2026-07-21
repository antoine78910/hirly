import { describe, expect, test } from "bun:test";
import {
  JobProjectionRepository,
  type Database,
  type JobProjectionLease,
} from "../src";

function databaseReturning(rows: unknown[]) {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const tag = ((strings: TemplateStringsArray, ...parameters: unknown[]) => {
    statements.push(strings.join("?"));
    values.push(parameters);
    return Promise.resolve(rows);
  }) as unknown as Database;
  tag.json = (value) => value as never;
  return { tag, statements, values };
}

const lease: JobProjectionLease = {
  taskId: "11111111-1111-4111-8111-111111111111",
  taskKind: "job.document.project",
  entityId: "22222222-2222-4222-8222-222222222222",
  entityVersion: 42n,
  idempotencyKey: "job:42",
  leaseOwner: "projection-1",
  leaseToken: "33333333-3333-4333-8333-333333333333",
  claimGeneration: 3n,
  leaseUntil: new Date("2026-07-21T08:00:00Z"),
  attempts: 2,
  maxAttempts: 8,
};

describe("job projection repository", () => {
  test("claims only through the bounded projection lease RPC", async () => {
    const database = databaseReturning([
      {
        task_id: lease.taskId,
        task_kind: lease.taskKind,
        entity_id: lease.entityId,
        entity_version: "42",
        idempotency_key: lease.idempotencyKey,
        lease_owner: lease.leaseOwner,
        lease_token: lease.leaseToken,
        claim_generation: "3",
        lease_until: lease.leaseUntil,
        attempts: 2,
        max_attempts: 8,
      },
    ]);
    const claimed = await new JobProjectionRepository(database.tag).claim(
      "projection-1",
      10,
      60,
    );
    expect(database.statements[0]).toContain(
      "worker_private.claim_job_projection_tasks",
    );
    expect(database.values[0]).toEqual(["projection-1", 10, 60]);
    expect(claimed[0]).toMatchObject({ entityVersion: 42n, claimGeneration: 3n });
  });

  test("persists documents only through the fenced completion RPC", async () => {
    const database = databaseReturning([
      { complete_job_projection_upsert: true },
    ]);
    const completed = await new JobProjectionRepository(
      database.tag,
    ).completeUpsert(
      lease,
      {
        schema_version: "hirly.matching.v1",
        canonical_group_id: lease.entityId,
        preferred_job_id: "job_0123456789abcdef",
        job_version: "42",
        lifecycle_status: "active",
        normalized_title: "software-engineer",
        role_family_codes: ["software-engineering"],
        rome_codes: [],
        skill_codes: [],
        seniority_min: null,
        seniority_max: null,
        contract_families: [],
        work_modes: [],
        country_codes: ["FR"],
        latitude: null,
        longitude: null,
        location_confidence: 0.6,
        location_unknown: false,
        salary_min: null,
        salary_max: null,
        currency: null,
        posted_at: "2026-07-20T00:00:00.000Z",
        last_seen_at: "2026-07-21T00:00:00.000Z",
        expires_at: null,
        validation_status: "valid",
        applyability_tier: "B",
        fulfillment_route: "manual",
        source_eligible: true,
        policy_eligible: true,
        feature_schema_version: "matching-job-features.v1",
        search_text: "software engineer",
        source_updated_at: "2026-07-21T00:00:00.000Z",
      },
      "a".repeat(64),
      12,
    );
    expect(completed).toBe(true);
    expect(database.statements[0]).toContain(
      "worker_private.complete_job_projection_upsert",
    );
    expect(database.statements[0]).not.toContain("UPDATE public.jobs");
    expect(database.values[0]?.slice(0, 4)).toEqual([
      lease.taskId,
      lease.leaseToken,
      "3",
      lease.leaseOwner,
    ]);
  });
});
