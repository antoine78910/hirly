import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../backend/db/migrations/20260720000300_job_ingestion_run_ledger.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../backend/db/migrations/20260720000300_job_ingestion_run_ledger.down.sql", import.meta.url),
  "utf8",
);

describe("job ingestion run-ledger migration", () => {
  test("extends the existing ledger without moving writer ownership", () => {
    expect(migration).toContain("ALTER TABLE public.worker_runs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.worker_run_partitions");
    expect(migration).toContain("complete_snapshot");
    expect(migration).not.toContain("UPDATE public.provider_registry SET writer_runtime");
    expect(migration).toContain("public.python_ingestion_run_begin");
    expect(migration).toContain("public.python_ingestion_run_complete");
    expect(migration).toContain("worker_runs_python_source_running_unique");
    expect(migration).toContain("lease_token = p_lease_token");
    expect(migration).toContain("lease_generation = p_lease_generation");
    expect(migration).toContain("lease_expires_at > clock_timestamp()");
    expect(migration).toContain("status = 'queued'");
    expect(migration).toContain("error_code = 'lease_expired'");
  });

  test("keeps Python interval metadata out of the Bun cron scheduler", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.python_ingestion_schedules");
    expect(migration).not.toContain("python-interval:");
    expect(migration).not.toContain("INSERT INTO public.worker_schedules");
    expect(migration).toContain("python_ingestion_schedule_sync");
    expect(migration).toContain("p_enabled boolean");
    expect(migration).not.toContain("('python-france-travail-harvest', 'france_travail', 300");
    expect(migration).toContain("ON CONFLICT (id) DO UPDATE SET");
  });

  test("exposes alertable failed, stale, zero and incomplete states", () => {
    for (const alert of [
      "failed_run", "stale_running", "unexpected_zero_records",
      "incomplete_success", "missed_expected_run", "material_coverage_drop",
      "repeated_partition_failure",
    ]) {
      expect(migration).toContain(alert);
    }
    expect(migration.match(/material_coverage_drop/g)?.length).toBeGreaterThanOrEqual(1);
    expect(migration).toContain("OR (run.status = 'succeeded' AND run.raw_records > 0");
    expect(migration).toContain("GROUP BY run.source_id, run.provider, partition.partition_id");
  });

  test("keeps terminal proof facts immutable and behind fenced RPCs", () => {
    expect(migration).toContain("ON CONFLICT (run_id, partition_id) DO NOTHING");
    expect(migration).not.toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.worker_run_partitions TO hirly_inventory_worker",
    );
    expect(migration).toContain("AND lease_token = p_lease_token");
  });

  test("uses the manifest-aware run-begin signature for privileges and rollback", () => {
    const signature =
      "public.python_ingestion_run_begin(text, text, integer, text, integer, jsonb)";

    expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`);
    expect(rollback).toContain(`DROP FUNCTION IF EXISTS ${signature}`);
  });

  test("has a reversible rollback", () => {
    expect(rollback).toContain("DROP VIEW IF EXISTS public.worker_ingestion_alerts");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.worker_run_partitions");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.python_ingestion_schedules");
    expect(rollback).toContain("DROP INDEX IF EXISTS public.worker_runs_python_source_running_unique");
    expect(rollback).toContain("DROP COLUMN IF EXISTS completeness_state");
  });
});
