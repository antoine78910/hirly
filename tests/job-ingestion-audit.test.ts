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
  });

  test("exposes alertable failed, stale, zero and incomplete states", () => {
    for (const alert of ["failed_run", "stale_running", "unexpected_zero_records", "incomplete_success", "missed_expected_run"]) {
      expect(migration).toContain(alert);
    }
  });

  test("has a reversible rollback", () => {
    expect(rollback).toContain("DROP VIEW IF EXISTS public.worker_ingestion_alerts");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.worker_run_partitions");
    expect(rollback).toContain("DROP COLUMN IF EXISTS completeness_state");
  });
});
