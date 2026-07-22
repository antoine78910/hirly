import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const databaseUrl = process.env.JOB_INGESTION_LEDGER_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(args: string[]): Promise<string> {
  if (!databaseUrl) throw new Error("JOB_INGESTION_LEDGER_TEST_DATABASE_URL is required");
  const process = Bun.spawn(["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout.trim();
}

async function apply(relativePath: string): Promise<void> {
  await psql(["-q", "-f", join(repoRoot, relativePath)]);
}

describe("Python ingestion ledger real-Postgres recovery", () => {
  runIntegration(
    "preserves prior generation evidence, fences stale owners, completes, and rolls back",
    async () => {
      await apply("backend/db/jobs_inventory_schema.sql");
      await apply("backend/db/migrations/20260720000100_typescript_worker_foundation.sql");
      await apply("backend/db/migrations/20260720000300_job_ingestion_run_ledger.sql");
      try {
        await psql([
          "-q",
          "-c",
          `
          DO $proof$
          DECLARE
            v_manifest jsonb := '{
              "manifest_version":"pg-reclaim.v1",
              "manifest_digest":"fixture",
              "expected_partition_count":1,
              "expected_partition_ids":["p1"],
              "geography_scope":"global",
              "countries":["*"],
              "remote_scope":"included"
            }'::jsonb;
            v_claim_1 jsonb;
            v_claim_2 jsonb;
            v_run_id uuid;
            v_token_1 uuid;
            v_token_2 uuid;
            v_generation_1 bigint;
            v_generation_2 bigint;
            v_summary jsonb;
          BEGIN
            v_claim_1 := public.python_ingestion_run_begin(
              'pg-reclaim', 'pg-reclaim-source', 3600, 'worker-old', 30, v_manifest
            );
            IF NOT (v_claim_1->>'acquired')::boolean THEN
              RAISE EXCEPTION 'first claim not acquired';
            END IF;
            v_run_id := (v_claim_1->>'run_id')::uuid;
            v_token_1 := (v_claim_1->>'lease_token')::uuid;
            v_generation_1 := (v_claim_1->>'lease_generation')::bigint;

            IF NOT public.python_ingestion_partition_record(
              v_run_id, v_token_1, v_generation_1, 'worker-old', 'p1',
              'completed_with_results',
              '{"pages_requested":1,"pages_completed":1,"raw_records":1}'::jsonb,
              NULL
            ) THEN
              RAISE EXCEPTION 'generation-one partition was not recorded';
            END IF;

            UPDATE public.worker_runs
            SET lease_expires_at = clock_timestamp() - interval '1 second'
            WHERE id = v_run_id;

            v_claim_2 := public.python_ingestion_run_begin(
              'pg-reclaim', 'pg-reclaim-source', 3600, 'worker-new', 30, v_manifest
            );
            v_token_2 := (v_claim_2->>'lease_token')::uuid;
            v_generation_2 := (v_claim_2->>'lease_generation')::bigint;
            IF NOT (v_claim_2->>'acquired')::boolean
              OR (v_claim_2->>'run_id')::uuid <> v_run_id
              OR v_generation_2 <> v_generation_1 + 1
            THEN
              RAISE EXCEPTION 'expired run was not reclaimed with a new generation';
            END IF;

            IF public.python_ingestion_partition_record(
              v_run_id, v_token_1, v_generation_1, 'worker-old', 'p1',
              'completed_with_results',
              '{"pages_requested":9,"pages_completed":9,"raw_records":9}'::jsonb,
              NULL
            ) THEN
              RAISE EXCEPTION 'stale generation mutated terminal proof';
            END IF;

            IF NOT public.python_ingestion_partition_record(
              v_run_id, v_token_2, v_generation_2, 'worker-new', 'p1',
              'completed_with_results',
              '{"pages_requested":2,"pages_completed":2,"raw_records":2}'::jsonb,
              NULL
            ) THEN
              RAISE EXCEPTION 'generation-two partition was not recorded';
            END IF;

            IF (
              SELECT count(*) <> 2
                OR min((counters->>'raw_records')::integer) <> 1
                OR max((counters->>'raw_records')::integer) <> 2
              FROM public.worker_run_partitions
              WHERE run_id = v_run_id AND partition_id = 'p1'
            ) THEN
              RAISE EXCEPTION 'partition generation history was not immutable';
            END IF;

            v_summary := jsonb_build_object(
              'authoritative_manifest', v_manifest,
              'proof_scope', jsonb_build_object(
                'scope_kind', 'global', 'providers', '[]'::jsonb
              ) || v_manifest,
              'accounting_contract', jsonb_build_object('state', 'known'),
              'pages_requested', 2, 'pages_completed', 2, 'retries', 0,
              'source_reported_total', 2, 'raw_records', 2, 'normalized_records', 2,
              'rejected_by_reason', '{}'::jsonb,
              'source_exact_duplicates', 0, 'exact_duplicates', 0,
              'jobs_inserted', 2, 'jobs_updated', 0, 'write_failed', 0,
              'jobs_reactivated', 0, 'jobs_marked_inactive', 0
            );
            IF NOT public.python_ingestion_run_complete(
              v_run_id, v_token_2, v_generation_2, 'worker-new',
              'succeeded', 'complete_snapshot', v_summary
            ) THEN
              RAISE EXCEPTION 'reclaimed run could not complete';
            END IF;
          END
          $proof$;
        `,
        ]);
      } finally {
        await apply("backend/db/migrations/20260720000300_job_ingestion_run_ledger.down.sql");
      }
      expect(
        await psql([
          "-A",
          "-t",
          "-q",
          "-c",
          "SELECT to_regclass('public.worker_run_partitions') IS NULL;",
        ]),
      ).toBe("t");
    },
    30_000,
  );
});
