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

CREATE OR REPLACE FUNCTION public.python_ingestion_run_begin(
  p_schedule_id text,
  p_source text,
  p_cadence_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_scheduled_for timestamptz;
  v_run_id uuid;
BEGIN
  IF length(btrim(p_schedule_id)) = 0
    OR length(btrim(p_source)) = 0
    OR p_cadence_seconds NOT BETWEEN 60 AND 86400
  THEN
    RAISE EXCEPTION 'invalid Python ingestion schedule claim' USING ERRCODE = '22023';
  END IF;
  v_scheduled_for := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_cadence_seconds) * p_cadence_seconds
  );

  INSERT INTO public.worker_schedules (
    id, task_type, provider, cron_expression, timezone, payload,
    enabled, next_due_at, last_enqueued_at, max_catch_up
  )
  VALUES (
    p_schedule_id, 'inventory.maintenance', NULL,
    'python-interval:' || p_cadence_seconds::text, 'UTC',
    jsonb_build_object('source', p_source), true,
    v_scheduled_for + make_interval(secs => p_cadence_seconds),
    v_scheduled_for, 0
  )
  ON CONFLICT (id) DO UPDATE SET
    payload = EXCLUDED.payload,
    enabled = true,
    next_due_at = greatest(public.worker_schedules.next_due_at, EXCLUDED.next_due_at),
    last_enqueued_at = greatest(public.worker_schedules.last_enqueued_at, EXCLUDED.last_enqueued_at),
    updated_at = clock_timestamp();

  INSERT INTO public.worker_runs (
    kind, provider, idempotency_key, trigger_source, status, schedule_id,
    scheduled_for, scheduled_start, started_at, heartbeat_at, summary
  )
  VALUES (
    'inventory_maintenance', NULL,
    'python:' || p_schedule_id || ':' || to_char(v_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'schedule', 'running', p_schedule_id, v_scheduled_for, v_scheduled_for,
    clock_timestamp(), clock_timestamp(), jsonb_build_object('source', p_source)
  )
  ON CONFLICT (kind, idempotency_key) DO NOTHING
  RETURNING id INTO v_run_id;

  IF v_run_id IS NULL THEN
    SELECT id INTO v_run_id
    FROM public.worker_runs
    WHERE kind = 'inventory_maintenance'
      AND idempotency_key = 'python:' || p_schedule_id || ':' || to_char(v_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    RETURN jsonb_build_object('acquired', false, 'run_id', v_run_id, 'scheduled_for', v_scheduled_for);
  END IF;
  RETURN jsonb_build_object('acquired', true, 'run_id', v_run_id, 'scheduled_for', v_scheduled_for);
END
$$;

CREATE OR REPLACE FUNCTION public.python_ingestion_run_heartbeat(p_run_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.worker_runs
  SET heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = p_run_id AND status = 'running'
  RETURNING true
$$;

CREATE OR REPLACE FUNCTION public.python_ingestion_run_complete(
  p_run_id uuid,
  p_status text,
  p_completeness_state text,
  p_summary jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('succeeded', 'partially_succeeded', 'failed')
    OR p_completeness_state NOT IN ('complete_snapshot', 'partial', 'capped', 'failed', 'blocked')
  THEN
    RAISE EXCEPTION 'invalid Python ingestion terminal state' USING ERRCODE = '22023';
  END IF;
  UPDATE public.worker_runs
  SET
    status = p_status,
    completeness_state = p_completeness_state,
    finished_at = clock_timestamp(),
    heartbeat_at = clock_timestamp(),
    summary = coalesce(p_summary, '{}'::jsonb),
    raw_records = CASE WHEN coalesce(p_summary->>'jobs_fetched', '') ~ '^[0-9]+$'
      THEN (p_summary->>'jobs_fetched')::integer ELSE 0 END,
    jobs_inserted = CASE WHEN coalesce(p_summary->>'jobs_upserted', '') ~ '^[0-9]+$'
      THEN (p_summary->>'jobs_upserted')::integer ELSE 0 END,
    error_code = CASE WHEN p_status = 'failed' THEN coalesce(p_summary->>'terminal_error', 'python_ingestion_failed') ELSE NULL END,
    updated_at = clock_timestamp()
  WHERE id = p_run_id AND status = 'running';
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION public.python_ingestion_run_begin(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_ingestion_run_heartbeat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_ingestion_run_complete(uuid, text, text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.python_ingestion_run_begin(text, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_ingestion_run_heartbeat(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_ingestion_run_complete(uuid, text, text, jsonb) TO service_role;
  END IF;
END
$$;

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
