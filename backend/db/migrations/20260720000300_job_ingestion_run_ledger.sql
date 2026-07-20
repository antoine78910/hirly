-- TS_NEW: additive accounting and fenced leases for current Python-owned ingestion loops.
-- Python interval metadata is deliberately isolated from worker_schedules because the Bun
-- scheduler accepts cron expressions only.
BEGIN;

ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pages_requested integer NOT NULL DEFAULT 0 CHECK (pages_requested >= 0),
  ADD COLUMN IF NOT EXISTS pages_completed integer NOT NULL DEFAULT 0 CHECK (pages_completed >= 0),
  ADD COLUMN IF NOT EXISTS retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  ADD COLUMN IF NOT EXISTS source_reported_total integer CHECK (source_reported_total IS NULL OR source_reported_total >= 0),
  ADD COLUMN IF NOT EXISTS raw_records integer NOT NULL DEFAULT 0 CHECK (raw_records >= 0),
  ADD COLUMN IF NOT EXISTS normalized_records integer NOT NULL DEFAULT 0 CHECK (normalized_records >= 0),
  ADD COLUMN IF NOT EXISTS rejected_by_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exact_duplicates integer CHECK (exact_duplicates IS NULL OR exact_duplicates >= 0),
  ADD COLUMN IF NOT EXISTS fuzzy_duplicate_candidates integer CHECK (fuzzy_duplicate_candidates IS NULL OR fuzzy_duplicate_candidates >= 0),
  ADD COLUMN IF NOT EXISTS jobs_inserted integer CHECK (jobs_inserted IS NULL OR jobs_inserted >= 0),
  ADD COLUMN IF NOT EXISTS jobs_updated integer CHECK (jobs_updated IS NULL OR jobs_updated >= 0),
  ADD COLUMN IF NOT EXISTS jobs_reactivated integer CHECK (jobs_reactivated IS NULL OR jobs_reactivated >= 0),
  ADD COLUMN IF NOT EXISTS jobs_marked_inactive integer NOT NULL DEFAULT 0 CHECK (jobs_marked_inactive >= 0),
  ADD COLUMN IF NOT EXISTS completeness_state text NOT NULL DEFAULT 'unknown'
    CHECK (completeness_state IN ('unknown', 'complete_snapshot', 'partial', 'capped', 'failed', 'blocked')),
  ADD CONSTRAINT worker_runs_page_accounting_guard CHECK (pages_completed <= pages_requested),
  ADD CONSTRAINT worker_runs_normalization_guard CHECK (normalized_records <= raw_records);

CREATE UNIQUE INDEX IF NOT EXISTS worker_runs_python_source_running_unique
  ON public.worker_runs (source_id)
  WHERE source_id IS NOT NULL AND status = 'running';

CREATE TABLE IF NOT EXISTS public.python_ingestion_schedules (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  source_id text NOT NULL CHECK (length(btrim(source_id)) > 0),
  cadence_seconds integer NOT NULL CHECK (cadence_seconds BETWEEN 60 AND 86400),
  enabled boolean NOT NULL DEFAULT true,
  next_expected_at timestamptz NOT NULL,
  last_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.python_ingestion_schedule_sync(
  p_schedule_id text,
  p_source text,
  p_cadence_seconds integer,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF length(btrim(p_schedule_id)) = 0
    OR length(btrim(p_source)) = 0
    OR p_cadence_seconds NOT BETWEEN 60 AND 86400
  THEN
    RAISE EXCEPTION 'invalid Python ingestion schedule registration' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.python_ingestion_schedules (
    id, source_id, cadence_seconds, enabled, next_expected_at
  )
  VALUES (
    p_schedule_id, p_source, p_cadence_seconds, p_enabled,
    clock_timestamp() + make_interval(secs => p_cadence_seconds)
  )
  ON CONFLICT (id) DO UPDATE SET
    source_id = EXCLUDED.source_id,
    cadence_seconds = EXCLUDED.cadence_seconds,
    enabled = EXCLUDED.enabled,
    next_expected_at = CASE
      WHEN public.python_ingestion_schedules.enabled IS DISTINCT FROM EXCLUDED.enabled
        THEN EXCLUDED.next_expected_at
      ELSE public.python_ingestion_schedules.next_expected_at
    END,
    updated_at = clock_timestamp();
  RETURN true;
END
$$;

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
  CONSTRAINT worker_run_partitions_page_guard CHECK (pages_completed <= pages_requested),
  CONSTRAINT worker_run_partitions_terminal_shape CHECK (
    (status IN ('completed_with_results', 'completed_zero_results', 'failed', 'blocked')) = (completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS worker_run_partitions_status_heartbeat_idx
  ON public.worker_run_partitions (status, heartbeat_at, run_id);

CREATE OR REPLACE FUNCTION public.python_ingestion_run_begin(
  p_schedule_id text,
  p_source text,
  p_cadence_seconds integer,
  p_lease_owner text,
  p_lease_seconds integer,
  p_manifest jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_scheduled_for timestamptz;
  v_run public.worker_runs%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF length(btrim(p_schedule_id)) = 0
    OR length(btrim(p_source)) = 0
    OR length(btrim(p_lease_owner)) = 0
    OR p_cadence_seconds NOT BETWEEN 60 AND 86400
    OR p_lease_seconds NOT BETWEEN 30 AND 3600
  THEN
    RAISE EXCEPTION 'invalid Python ingestion schedule claim' USING ERRCODE = '22023';
  END IF;

  v_scheduled_for := to_timestamp(
    floor(extract(epoch FROM v_now) / p_cadence_seconds) * p_cadence_seconds
  );

  INSERT INTO public.python_ingestion_schedules (
    id, source_id, cadence_seconds, enabled, next_expected_at, last_claimed_at
  )
  VALUES (
    p_schedule_id, p_source, p_cadence_seconds, true,
    v_scheduled_for + make_interval(secs => p_cadence_seconds), v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    source_id = EXCLUDED.source_id,
    cadence_seconds = EXCLUDED.cadence_seconds,
    enabled = true,
    next_expected_at = EXCLUDED.next_expected_at,
    last_claimed_at = EXCLUDED.last_claimed_at,
    updated_at = v_now;

  -- Expired work becomes resumable. A prior owner can no longer heartbeat or complete
  -- because every mutation below is fenced by token + generation + owner.
  UPDATE public.worker_runs
  SET status = 'queued',
      error_code = 'lease_expired',
      error_message = 'run lease expired before terminal completion',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
  WHERE source_id = p_source
    AND status = 'running'
    AND lease_expires_at <= v_now;

  SELECT * INTO v_run
  FROM public.worker_runs
  WHERE kind = 'inventory_maintenance'
    AND idempotency_key = 'python:' || p_schedule_id || ':' ||
      to_char(v_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  FOR UPDATE;

  IF FOUND AND v_run.status NOT IN ('queued') THEN
    RETURN jsonb_build_object(
      'acquired', false, 'run_id', v_run.id, 'scheduled_for', v_scheduled_for,
      'status', v_run.status
    );
  END IF;

  IF FOUND THEN
    UPDATE public.worker_runs
    SET status = 'running',
        started_at = coalesce(started_at, v_now),
        heartbeat_at = v_now,
        lease_owner = p_lease_owner,
        lease_token = v_token,
        lease_generation = lease_generation + 1,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        error_code = NULL,
        error_message = NULL,
        updated_at = v_now
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  ELSE
    BEGIN
      INSERT INTO public.worker_runs (
        kind, provider, source_id, idempotency_key, trigger_source, status, schedule_id,
        scheduled_for, scheduled_start, started_at, heartbeat_at,
        lease_owner, lease_token, lease_generation, lease_expires_at, summary
      )
      VALUES (
        'inventory_maintenance', NULL, p_source,
        'python:' || p_schedule_id || ':' ||
          to_char(v_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'schedule', 'running', p_schedule_id, v_scheduled_for, v_scheduled_for,
        v_now, v_now, p_lease_owner, v_token, 1,
        v_now + make_interval(secs => p_lease_seconds),
        jsonb_strip_nulls(jsonb_build_object(
          'source', p_source,
          'authoritative_manifest', p_manifest
        ))
      )
      RETURNING * INTO v_run;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_run
      FROM public.worker_runs
      WHERE source_id = p_source AND status = 'running'
      ORDER BY started_at DESC
      LIMIT 1;
      RETURN jsonb_build_object(
        'acquired', false, 'run_id', v_run.id, 'scheduled_for', v_run.scheduled_for,
        'status', v_run.status
      );
    END;
  END IF;

  RETURN jsonb_build_object(
    'acquired', true,
    'run_id', v_run.id,
    'scheduled_for', v_scheduled_for,
    'lease_token', v_run.lease_token,
    'lease_generation', v_run.lease_generation,
    'lease_owner', v_run.lease_owner,
    'lease_expires_at', v_run.lease_expires_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.python_ingestion_run_heartbeat(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_generation bigint,
  p_lease_owner text,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.worker_runs
  SET heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE id = p_run_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_generation = p_lease_generation
    AND lease_owner = p_lease_owner
    AND lease_expires_at > clock_timestamp()
  RETURNING true
$$;

CREATE OR REPLACE FUNCTION public.python_ingestion_partition_record(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_generation bigint,
  p_lease_owner text,
  p_partition_id text,
  p_status text,
  p_counters jsonb,
  p_terminal_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('completed_with_results', 'completed_zero_results', 'failed', 'blocked')
    OR length(btrim(p_partition_id)) = 0
    OR NOT EXISTS (
      SELECT 1 FROM public.worker_runs
      WHERE id = p_run_id
        AND status = 'running'
        AND lease_token = p_lease_token
        AND lease_generation = p_lease_generation
        AND lease_owner = p_lease_owner
        AND lease_expires_at > clock_timestamp()
    )
  THEN
    RETURN false;
  END IF;
  INSERT INTO public.worker_run_partitions (
    run_id, partition_id, status, started_at, heartbeat_at, completed_at,
    pages_requested, pages_completed, retries, source_reported_total,
    counters, terminal_error_code, terminal_error_reason
  )
  VALUES (
    p_run_id, p_partition_id, p_status, clock_timestamp(), clock_timestamp(), clock_timestamp(),
    coalesce((p_counters->>'pages_requested')::integer, 0),
    coalesce((p_counters->>'pages_completed')::integer, 0),
    coalesce((p_counters->>'retries')::integer, 0),
    nullif(p_counters->>'source_reported_total', '')::integer,
    coalesce(p_counters, '{}'::jsonb),
    CASE WHEN p_status IN ('failed', 'blocked') THEN coalesce(p_counters->>'error_code', p_status) END,
    left(p_terminal_error, 1000)
  )
  ON CONFLICT (run_id, partition_id) DO NOTHING;
  RETURN EXISTS (
    SELECT 1
    FROM public.worker_run_partitions
    WHERE run_id = p_run_id
      AND partition_id = p_partition_id
      AND status = p_status
      AND counters = coalesce(p_counters, '{}'::jsonb)
      AND coalesce(terminal_error_reason, '') = coalesce(left(p_terminal_error, 1000), '')
  );
END
$$;

CREATE OR REPLACE FUNCTION public.python_ingestion_run_complete(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_generation bigint,
  p_lease_owner text,
  p_status text,
  p_completeness_state text,
  p_summary jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rejected jsonb := coalesce(p_summary->'rejected_by_reason', '{}'::jsonb);
  v_registered_manifest jsonb;
BEGIN
  SELECT summary->'authoritative_manifest'
  INTO v_registered_manifest
  FROM public.worker_runs
  WHERE id = p_run_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_generation = p_lease_generation
    AND lease_owner = p_lease_owner;
  IF p_status NOT IN ('succeeded', 'partially_succeeded', 'failed')
    OR p_completeness_state NOT IN ('complete_snapshot', 'partial', 'capped', 'failed', 'blocked')
    OR jsonb_typeof(v_rejected) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid Python ingestion terminal state' USING ERRCODE = '22023';
  END IF;
  IF p_completeness_state = 'complete_snapshot' AND (
    NOT EXISTS (SELECT 1 FROM public.worker_run_partitions WHERE run_id = p_run_id)
    OR EXISTS (
      SELECT 1 FROM public.worker_run_partitions
      WHERE run_id = p_run_id
        AND status NOT IN ('completed_with_results', 'completed_zero_results')
    )
  ) THEN
    RAISE EXCEPTION 'complete snapshot requires terminal complete partition proof'
      USING ERRCODE = '22023';
  END IF;
  IF p_completeness_state = 'complete_snapshot' AND (
    v_registered_manifest IS NULL
    OR v_registered_manifest IS DISTINCT FROM p_summary->'authoritative_manifest'
    OR
    p_summary->'proof_scope' IS NULL
    OR p_summary->'authoritative_manifest' IS NULL
    OR (p_summary->'proof_scope') - 'scope_kind' - 'providers'
      IS DISTINCT FROM p_summary->'authoritative_manifest'
    OR jsonb_array_length(coalesce(
      p_summary->'authoritative_manifest'->'expected_partition_ids', '[]'::jsonb
    )) = 0
    OR (p_summary->'authoritative_manifest'->>'expected_partition_count')::integer
      IS DISTINCT FROM jsonb_array_length(
        p_summary->'authoritative_manifest'->'expected_partition_ids'
      )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        p_summary->'authoritative_manifest'->'expected_partition_ids'
      ) AS expected(partition_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.worker_run_partitions AS actual
        WHERE actual.run_id = p_run_id
          AND actual.partition_id = expected.partition_id
          AND actual.status IN ('completed_with_results', 'completed_zero_results')
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.worker_run_partitions AS actual
      WHERE actual.run_id = p_run_id
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            p_summary->'authoritative_manifest'->'expected_partition_ids'
          ) AS expected(partition_id)
          WHERE expected.partition_id = actual.partition_id
        )
    )
  ) THEN
    RAISE EXCEPTION 'complete snapshot requires exact authoritative manifest proof'
      USING ERRCODE = '22023';
  END IF;
  IF p_completeness_state = 'complete_snapshot' AND (
    p_summary->'accounting_contract'->>'state' IS DISTINCT FROM 'known'
    OR (p_summary->>'raw_records')::integer IS DISTINCT FROM (
      (p_summary->>'normalized_records')::integer
      + coalesce((
          SELECT sum(value::integer)
          FROM jsonb_each_text(coalesce(p_summary->'rejected_by_reason', '{}'::jsonb))
        ), 0)
    )
    OR (p_summary->>'normalized_records')::integer IS DISTINCT FROM (
      (p_summary->>'jobs_inserted')::integer
      + (p_summary->>'jobs_updated')::integer
      + (p_summary->>'exact_duplicates')::integer
      + (p_summary->>'write_failed')::integer
    )
  ) THEN
    RAISE EXCEPTION 'complete snapshot requires reconciled known accounting'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.worker_runs
  SET status = p_status,
      completeness_state = p_completeness_state,
      finished_at = clock_timestamp(),
      heartbeat_at = clock_timestamp(),
      lease_expires_at = NULL,
      summary = coalesce(p_summary, '{}'::jsonb),
      pages_requested = coalesce((p_summary->>'pages_requested')::integer, 0),
      pages_completed = coalesce((p_summary->>'pages_completed')::integer, 0),
      retries = coalesce((p_summary->>'retries')::integer, 0),
      source_reported_total = nullif(p_summary->>'source_reported_total', '')::integer,
      raw_records = coalesce((p_summary->>'raw_records')::integer, (p_summary->>'jobs_fetched')::integer, 0),
      normalized_records = coalesce((p_summary->>'normalized_records')::integer, (p_summary->>'jobs_fetched')::integer, 0),
      rejected_by_reason = v_rejected,
      exact_duplicates = nullif(p_summary->>'exact_duplicates', '')::integer,
      fuzzy_duplicate_candidates = nullif(p_summary->>'fuzzy_duplicate_candidates', '')::integer,
      jobs_inserted = nullif(p_summary->>'jobs_inserted', '')::integer,
      jobs_updated = nullif(p_summary->>'jobs_updated', '')::integer,
      jobs_reactivated = nullif(p_summary->>'jobs_reactivated', '')::integer,
      jobs_marked_inactive = coalesce((p_summary->>'jobs_marked_inactive')::integer, 0),
      error_code = CASE WHEN p_status = 'failed'
        THEN coalesce(p_summary->>'terminal_error_code', 'python_ingestion_failed') ELSE NULL END,
      error_message = CASE WHEN p_status = 'failed'
        THEN left(coalesce(p_summary->>'terminal_error', 'Python ingestion failed'), 1000) ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE id = p_run_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_generation = p_lease_generation
    AND lease_owner = p_lease_owner
    AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION public.python_ingestion_run_begin(text, text, integer, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_ingestion_schedule_sync(text, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_ingestion_run_heartbeat(uuid, uuid, bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_ingestion_partition_record(uuid, uuid, bigint, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_ingestion_run_complete(uuid, uuid, bigint, text, text, text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.python_ingestion_schedule_sync(text, text, integer, boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_ingestion_run_begin(text, text, integer, text, integer, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_ingestion_run_heartbeat(uuid, uuid, bigint, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_ingestion_partition_record(uuid, uuid, bigint, text, text, text, jsonb, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_ingestion_run_complete(uuid, uuid, bigint, text, text, text, jsonb) TO service_role;
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
    WHEN run.status = 'running' AND run.lease_expires_at <= clock_timestamp() THEN 'stale_running'
    WHEN run.status = 'succeeded' AND run.summary ? 'raw_records' AND run.raw_records = 0 THEN 'unexpected_zero_records'
    WHEN run.status = 'succeeded' AND run.raw_records > 0 AND run.raw_records < (
      SELECT avg(previous.raw_records) * 0.5
      FROM (
        SELECT prior.raw_records
        FROM public.worker_runs AS prior
        WHERE prior.source_id = run.source_id
          AND prior.status = 'succeeded'
          AND prior.id <> run.id
          AND prior.raw_records > 0
        ORDER BY prior.finished_at DESC
        LIMIT 5
      ) AS previous
    ) THEN 'material_coverage_drop'
    WHEN run.status IN ('succeeded', 'partially_succeeded') AND run.completeness_state <> 'complete_snapshot'
      THEN 'incomplete_success'
    ELSE NULL
  END AS alert_code,
  run.requested_at,
  run.heartbeat_at,
  run.finished_at
FROM public.worker_runs AS run
WHERE run.status = 'failed'
   OR (run.status = 'running' AND run.lease_expires_at <= clock_timestamp())
   OR (run.status = 'succeeded' AND run.summary ? 'raw_records' AND run.raw_records = 0)
   OR (run.status = 'succeeded' AND run.raw_records > 0 AND run.raw_records < (
     SELECT avg(previous.raw_records) * 0.5
     FROM (
       SELECT prior.raw_records
       FROM public.worker_runs AS prior
       WHERE prior.source_id = run.source_id
         AND prior.status = 'succeeded'
         AND prior.id <> run.id
         AND prior.raw_records > 0
       ORDER BY prior.finished_at DESC
       LIMIT 5
     ) AS previous
   ))
   OR (run.status IN ('succeeded', 'partially_succeeded') AND run.completeness_state <> 'complete_snapshot')
UNION ALL
SELECT NULL::uuid, NULL::text, 'missed_expected_run'::text,
       schedule.next_expected_at, NULL::timestamptz, NULL::timestamptz
FROM public.python_ingestion_schedules AS schedule
WHERE schedule.enabled
  AND schedule.next_expected_at < clock_timestamp() - make_interval(secs => schedule.cadence_seconds)
UNION ALL
SELECT NULL::uuid, run.provider, 'repeated_partition_failure'::text,
       max(run.requested_at), max(partition.heartbeat_at), max(partition.completed_at)
FROM public.worker_run_partitions AS partition
JOIN public.worker_runs AS run ON run.id = partition.run_id
WHERE partition.status = 'failed'
  AND run.source_id IS NOT NULL
  AND partition.partition_id IS NOT NULL
GROUP BY run.source_id, run.provider, partition.partition_id
HAVING count(*) >= 3;

REVOKE ALL ON public.python_ingestion_schedules FROM PUBLIC;
REVOKE ALL ON public.worker_run_partitions FROM PUBLIC;
REVOKE ALL ON public.worker_ingestion_alerts FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.python_ingestion_schedules, public.worker_run_partitions, public.worker_runs FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_inventory_worker') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.python_ingestion_schedules, public.worker_run_partitions, public.worker_runs FROM hirly_inventory_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_inventory_operator') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.python_ingestion_schedules, public.worker_run_partitions, public.worker_runs FROM hirly_inventory_operator;
  END IF;
END
$$;
GRANT SELECT ON public.python_ingestion_schedules, public.worker_run_partitions, public.worker_ingestion_alerts
  TO hirly_inventory_reader, hirly_inventory_operator;
-- Proof partitions are writable only through the fenced service-role RPC.

COMMIT;
