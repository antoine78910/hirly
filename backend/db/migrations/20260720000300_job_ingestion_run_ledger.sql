-- TS_NEW: additive accounting for the existing durable worker ledger.
-- This does not transfer scheduler dispatch or canonical job-writer ownership.
BEGIN;

ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS pages_requested integer NOT NULL DEFAULT 0 CHECK (pages_requested >= 0),
  ADD COLUMN IF NOT EXISTS pages_completed integer NOT NULL DEFAULT 0 CHECK (pages_completed >= 0),
  ADD COLUMN IF NOT EXISTS retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  ADD COLUMN IF NOT EXISTS source_reported_total integer CHECK (source_reported_total IS NULL OR source_reported_total >= 0),
  ADD COLUMN IF NOT EXISTS raw_records integer NOT NULL DEFAULT 0 CHECK (raw_records >= 0),
  ADD COLUMN IF NOT EXISTS normalized_records integer NOT NULL DEFAULT 0 CHECK (normalized_records >= 0),
  ADD COLUMN IF NOT EXISTS rejected_by_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exact_duplicates integer NOT NULL DEFAULT 0 CHECK (exact_duplicates >= 0),
  ADD COLUMN IF NOT EXISTS fuzzy_duplicate_candidates integer NOT NULL DEFAULT 0 CHECK (fuzzy_duplicate_candidates >= 0),
  ADD COLUMN IF NOT EXISTS jobs_inserted integer NOT NULL DEFAULT 0 CHECK (jobs_inserted >= 0),
  ADD COLUMN IF NOT EXISTS jobs_updated integer NOT NULL DEFAULT 0 CHECK (jobs_updated >= 0),
  ADD COLUMN IF NOT EXISTS jobs_reactivated integer NOT NULL DEFAULT 0 CHECK (jobs_reactivated >= 0),
  ADD COLUMN IF NOT EXISTS jobs_marked_inactive integer NOT NULL DEFAULT 0 CHECK (jobs_marked_inactive >= 0),
  ADD COLUMN IF NOT EXISTS completeness_state text NOT NULL DEFAULT 'unknown'
    CHECK (completeness_state IN ('unknown', 'complete_snapshot', 'partial', 'capped', 'failed', 'blocked'));

CREATE TABLE IF NOT EXISTS public.worker_run_partitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  partition_id text NOT NULL CHECK (length(btrim(partition_id)) > 0),
  status text NOT NULL CHECK (
    status IN ('planned', 'running', 'completed_with_results', 'completed_zero_results', 'failed', 'blocked')
  ),
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  pages_requested integer NOT NULL DEFAULT 0 CHECK (pages_requested >= 0),
  pages_completed integer NOT NULL DEFAULT 0 CHECK (pages_completed >= 0),
  retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  source_reported_total integer CHECK (source_reported_total IS NULL OR source_reported_total >= 0),
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  terminal_error_code text,
  terminal_error_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_run_partitions_unique UNIQUE (run_id, partition_id),
  CONSTRAINT worker_run_partitions_terminal_shape CHECK (
    (status IN ('completed_with_results', 'completed_zero_results', 'failed', 'blocked')) = (completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS worker_run_partitions_status_heartbeat_idx
  ON public.worker_run_partitions (status, heartbeat_at, run_id);

CREATE OR REPLACE VIEW public.worker_ingestion_alerts
WITH (security_barrier = true)
AS
SELECT
  run.id AS run_id,
  run.provider,
  CASE
    WHEN run.status = 'failed' THEN 'failed_run'
    WHEN run.status = 'running' AND run.heartbeat_at < clock_timestamp() - interval '15 minutes' THEN 'stale_running'
    WHEN run.status = 'succeeded' AND run.raw_records = 0 THEN 'unexpected_zero_records'
    WHEN run.status IN ('succeeded', 'partially_succeeded') AND run.completeness_state <> 'complete_snapshot'
      THEN 'incomplete_success'
    ELSE NULL
  END AS alert_code,
  run.requested_at,
  run.heartbeat_at,
  run.finished_at
FROM public.worker_runs AS run
WHERE run.status = 'failed'
   OR (run.status = 'running' AND run.heartbeat_at < clock_timestamp() - interval '15 minutes')
   OR (run.status = 'succeeded' AND run.raw_records = 0)
   OR (run.status IN ('succeeded', 'partially_succeeded') AND run.completeness_state <> 'complete_snapshot')
UNION ALL
SELECT
  NULL::uuid AS run_id,
  schedule.provider,
  'missed_expected_run'::text AS alert_code,
  schedule.next_due_at AS requested_at,
  NULL::timestamptz AS heartbeat_at,
  NULL::timestamptz AS finished_at
FROM public.worker_schedules AS schedule
WHERE schedule.enabled
  AND schedule.next_due_at < clock_timestamp() - interval '15 minutes';

REVOKE ALL ON public.worker_run_partitions FROM PUBLIC;
REVOKE ALL ON public.worker_ingestion_alerts FROM PUBLIC;
GRANT SELECT ON public.worker_run_partitions, public.worker_ingestion_alerts
  TO hirly_inventory_reader, hirly_inventory_operator;
GRANT SELECT, INSERT, UPDATE ON public.worker_run_partitions TO hirly_inventory_worker;

COMMIT;
