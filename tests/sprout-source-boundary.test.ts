import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260720002000_sprout_source_ingestion.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../backend/db/migrations/20260720002000_sprout_source_ingestion.down.sql",
    import.meta.url,
  ),
  "utf8",
);
const canaryMigration = readFileSync(
  new URL(
    "../backend/db/migrations/20260720002100_sprout_canary_gate.sql",
    import.meta.url,
  ),
  "utf8",
);
const canaryRollback = readFileSync(
  new URL(
    "../backend/db/migrations/20260720002100_sprout_canary_gate.down.sql",
    import.meta.url,
  ),
  "utf8",
);
const databaseRepository = readFileSync(
  new URL("../packages/db/src/index.ts", import.meta.url),
  "utf8",
);

describe("Sprout source persistence boundary", () => {
  test("registers the provider and France source fail-closed", () => {
    expect(migration).toContain("'sprout'");
    expect(migration).toContain("'unverified'");
    expect(migration).toContain("MERGE INTO public.provider_registry");
    expect(migration).toContain("'{\"requestsPerMinute\":1,\"concurrency\":1}'");
    expect(migration).toContain("'sprout:france'");
    expect(migration).toContain("ARRAY['FR']::text[]");
    expect(migration).toContain("MERGE INTO public.career_sources");
    expect(migration).not.toMatch(
      /INSERT\s*\([^)]*\b(?:enabled|transport_enabled|incremental_enabled|backfill_enabled)\b/i,
    );
    expect(migration).toContain("'{\"FR\":true}'::jsonb");
    expect(migration).not.toMatch(
      /'sprout'[\s\S]{0,500}'authorized'[\s\S]{0,500}true[\s\S]{0,500}'typescript'/,
    );
  });

  test("fences the atomic writer by task lease, ownership, policy, and checkpoint", () => {
    expect(migration).toContain("worker_private.commit_sprout_source_page");
    for (const gate of [
      "task.lease_token = p_lease_token",
      "task.claim_generation = p_claim_generation",
      "claim.expires_at > clock_timestamp()",
      "registry.authorization_status = 'authorized'",
      "registry.writer_runtime = 'typescript'",
      "registry.ownership_epoch = claim.ownership_epoch",
      "source.checkpoint = p_checkpoint_in",
      "worker_private.career_source_runnable(p_source_id, 'FR', p_mode)",
    ]) {
      expect(migration).toContain(gate);
    }
    expect(migration).toContain("worker_private.finish_task(");
    expect(migration).toContain("SET checkpoint = p_checkpoint_out");
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)/i);
    expect(migration).toContain("TO hirly_inventory_worker");
    expect(migration).toContain(
      "jsonb_array_length(p_entries) NOT BETWEEN 0 AND 500",
    );
  });

  test("exposes runnable metadata without persisting credential material", () => {
    expect(migration).toContain("credential_ref text");
    expect(migration).toContain("approved_page_size integer");
    expect(migration).toContain(
      "worker_private.get_sprout_source_runtime",
    );
    expect(migration).toContain(
      "worker_private.career_source_runnable(source.id, 'FR', p_mode)",
    );
    expect(migration).toContain(
      "(source.checkpoint->>'pageSize')::integer = source.approved_page_size",
    );
    expect(migration).toContain("'^secret://[a-z0-9][a-z0-9/_-]{2,127}$'");
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS worker_private.get_sprout_source_runtime",
    );
  });

  test("preserves immutable raw evidence, occurrence identity, and collision evidence", () => {
    expect(migration).toContain("INSERT INTO public.raw_job_snapshots");
    expect(migration).toContain(
      "ON CONFLICT (run_id, source_id, external_id, content_hash) DO NOTHING",
    );
    expect(migration).toContain("INSERT INTO public.job_occurrences");
    expect(migration).toContain("ON CONFLICT (source_id, external_id) DO UPDATE");
    expect(migration).toContain("public.source_identity_collisions");
    expect(migration).toContain("ats_id_conflicts_with_apply_url");
    expect(migration).toContain("apply_url_conflicts_with_ats_id");
    expect(migration).toContain("canonical_job_group_members");
    expect(rollback).toContain(
      "refusing to roll back activated or evidence-bearing Sprout source",
    );
  });

  test("reuses one canonical group across duplicate upserts and strong matches", () => {
    expect(migration).toContain(
      "SELECT canonical_group_id INTO v_group_id",
    );
    expect(migration).toContain("IF v_group_id IS NULL THEN");
    expect(migration).toContain(
      "ELSIF v_match_group_id IS NULL THEN",
    );
    expect(migration).toContain(
      "preferred_job_id, merge_confidence, merge_reason",
    );
    expect(migration).toContain(
      "v_group_id, v_match_job_id, 'source_identity', 1",
    );
    expect(migration).toContain(
      "WHERE job_id = v_match_job_id AND canonical_group_id IS NULL",
    );
    expect(migration).toContain(
      "ON CONFLICT (source_id, external_id) DO UPDATE",
    );
    expect(migration).toContain("ON CONFLICT (job_id) DO NOTHING");
  });

  test("maps additive canonical columns into both writer paths", () => {
    for (const column of [
      "city",
      "region",
      "remote",
      "salary_min",
      "salary_max",
      "currency",
      "posted_at",
      "imported_at",
      "last_seen_at",
    ]) {
      expect(databaseRepository).toContain(`${column}:`);
      expect(migration).toContain(column);
    }
  });

  test("contains no live credential or authorization header material", () => {
    for (const body of [
      migration,
      rollback,
      canaryMigration,
      canaryRollback,
      databaseRepository,
    ]) {
      expect(body).not.toMatch(/Authorization:\s*Bearer/i);
      expect(body).not.toMatch(/refresh[_-]?token/i);
      expect(body).not.toMatch(/cookie:/i);
    }
  });

  test("adds a default-off DB-backed one-page canary gate", () => {
    expect(canaryMigration).toContain(
      "ADD COLUMN canary_enabled boolean NOT NULL DEFAULT false",
    );
    expect(canaryMigration).toContain("ADD COLUMN canary_evidence jsonb NOT NULL");
    expect(canaryMigration).toContain("ADD COLUMN rollback_evidence jsonb NOT NULL");
    expect(canaryMigration).toContain(
      "p_mode IN ('canary', 'incremental', 'backfill')",
    );
    expect(canaryMigration).toContain(
      "WHEN 'canary' THEN source.provider = 'sprout' AND source.canary_enabled",
    );
    expect(canaryMigration).toContain("coalesce(p_checkpoint_in->>'offset', '') <> '0'");
    expect(canaryMigration).toContain(
      "source.canary_evidence->>'pagesCommitted' = '0'",
    );
    expect(canaryMigration).toContain(
      "canary_evidence = CASE",
    );
    expect(canaryMigration).toContain(
      "canary_evidence, '{pagesCommitted}', '1'::jsonb, true",
    );
    expect(canaryMigration).not.toMatch(
      /UPDATE\s+public\.career_sources[\s\S]{0,300}SET[\s\S]{0,100}canary_enabled\s*=\s*true/i,
    );
  });

  test("blocks production modes until canary read-back and rollback pass", () => {
    for (const gate of [
      "source.canary_evidence->>'status' = 'passed'",
      "(source.canary_evidence->>'pagesCommitted')::integer = 1",
      "(source.canary_evidence->>'identityReadBack')::boolean",
      "(source.canary_evidence->>'rawSnapshotLinked')::boolean",
      "(source.canary_evidence->>'occurrenceLinked')::boolean",
      "(source.canary_evidence->>'checkpointReadBack')::boolean",
      "(source.canary_evidence->>'singleWriterVerified')::boolean",
      "source.rollback_evidence->>'status' = 'passed'",
      "(source.rollback_evidence->>'providerKillSwitchVerified')::boolean",
      "(source.rollback_evidence->>'sourceKillSwitchVerified')::boolean",
      "(source.rollback_evidence->>'scheduleDisableVerified')::boolean",
      "(source.rollback_evidence->>'transportDisableVerified')::boolean",
      "(source.rollback_evidence->>'outstandingTasksStopVerified')::boolean",
      "(source.rollback_evidence->>'writerClaimReleaseVerified')::boolean",
    ]) {
      expect(canaryMigration).toContain(gate);
    }
    expect(canaryRollback).toContain(
      "refusing to roll back Sprout canary activation or evidence state",
    );
    expect(canaryRollback).toContain("DROP COLUMN canary_enabled");
  });
});
