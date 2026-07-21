import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sproutTaskPayloadSchema } from "../apps/worker/src/providers/sprout";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260721003500_sprout_incremental_frontier_schedule.sql",
    import.meta.url,
  ),
  "utf8",
);

const activationMigration = readFileSync(
  new URL(
    "../backend/db/migrations/20260721003600_enable_sprout_frontier_incremental_lane.sql",
    import.meta.url,
  ),
  "utf8",
);

const scheduledRunMigration = readFileSync(
  new URL(
    "../backend/db/migrations/20260721003700_bind_sprout_scheduled_runs_to_source.sql",
    import.meta.url,
  ),
  "utf8",
);

const sourceId = "11111111-1111-4111-8111-111111111111";

describe("Sprout incremental frontier cycles", () => {
  test("allows only an explicit first task to rewind a bounded scan", () => {
    expect(sproutTaskPayloadSchema.parse({
      sourceId,
      mode: "incremental",
      maxResponseBytes: 2_000_000,
      cycleStart: true,
      pageCount: 0,
      maxPages: 10,
    })).toMatchObject({ cycleStart: true, pageCount: 0, maxPages: 10 });
    expect(sproutTaskPayloadSchema.parse({
      sourceId,
      mode: "backfill",
      maxResponseBytes: 2_000_000,
    })).toMatchObject({ cycleStart: false, pageCount: 0, maxPages: null });
  });

  test("fences the rewind by the active task and writer claim, then enables one hourly schedule", () => {
    expect(migration).toContain("worker_private.begin_sprout_incremental_cycle");
    for (const guard of [
      "task.lease_token = p_lease_token",
      "task.claim_generation = p_claim_generation",
      "claim.expires_at > clock_timestamp()",
      "registry.writer_runtime = 'typescript'",
      "worker_private.career_source_runnable(p_source_id, 'FR', 'incremental')",
    ]) {
      expect(migration).toContain(guard);
    }
    expect(migration).toContain("'offset', 0");
    expect(migration).toContain("'sprout-france-country-only-frontier-hourly'");
    expect(migration).toContain("'7 * * * *'");
    expect(migration).toContain("'maxPages', 10");
    expect(migration).toContain("worker_private.set_schedule_enabled");
  });

  test("enables incremental mode only for the approved passed-canary frontier lane", () => {
    expect(activationMigration).toContain("source.source_key = 'sprout:france:country-only'");
    expect(activationMigration).toContain("SET incremental_enabled = true");
    expect(activationMigration).toContain("source.discovery_state = 'approved'");
    expect(activationMigration).toContain("source.canary_evidence->>'status' = 'passed'");
  });

  test("binds a scheduled source-less run under the fenced source claim", () => {
    expect(scheduledRunMigration).toContain(
      "(run.career_source_id IS NULL OR run.career_source_id = p_source_id)",
    );
    expect(scheduledRunMigration).toContain("SET career_source_id = p_source_id");
    expect(scheduledRunMigration).toContain("AND career_source_id IS NULL");
  });
});
