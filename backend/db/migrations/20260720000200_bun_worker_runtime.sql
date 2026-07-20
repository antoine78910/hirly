-- Narrow runtime reads for the Bun worker. This migration is additive and
-- intentionally exposes no provider payload or arbitrary table access.
BEGIN;

CREATE OR REPLACE FUNCTION worker_private.provider_runnable(p_provider text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.provider_registry
    WHERE provider = p_provider
      AND enabled
      AND authorization_status = 'authorized'
      AND writer_runtime = 'typescript'
  )
$$;

CREATE OR REPLACE FUNCTION worker_private.list_due_schedules(p_limit integer)
RETURNS TABLE (
  id text,
  cron_expression text,
  timezone text,
  next_due_at timestamptz,
  max_catch_up integer,
  database_now timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid due schedule limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT
    schedule.id,
    schedule.cron_expression,
    schedule.timezone,
    schedule.next_due_at,
    schedule.max_catch_up,
    clock_timestamp()
  FROM public.worker_schedules AS schedule
  WHERE schedule.enabled
    AND schedule.next_due_at <= clock_timestamp()
  ORDER BY schedule.next_due_at, schedule.id
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.get_run(p_run_id uuid)
RETURNS TABLE (
  id uuid,
  kind text,
  provider text,
  trigger_source text,
  status text,
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  summary jsonb,
  error_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT
    run.id,
    run.kind,
    run.provider,
    run.trigger_source,
    run.status,
    run.requested_at,
    run.started_at,
    run.finished_at,
    run.summary,
    run.error_code
  FROM public.worker_runs AS run
  WHERE run.id = p_run_id
$$;

REVOKE ALL ON FUNCTION worker_private.provider_runnable(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.list_due_schedules(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.get_run(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION worker_private.provider_runnable(text) FROM anon;
    REVOKE ALL ON FUNCTION worker_private.list_due_schedules(integer) FROM anon;
    REVOKE ALL ON FUNCTION worker_private.get_run(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION worker_private.provider_runnable(text) FROM authenticated;
    REVOKE ALL ON FUNCTION worker_private.list_due_schedules(integer) FROM authenticated;
    REVOKE ALL ON FUNCTION worker_private.get_run(uuid) FROM authenticated;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION worker_private.provider_runnable(text)
  TO hirly_inventory_worker, hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.list_due_schedules(integer)
  TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.get_run(uuid)
  TO hirly_inventory_worker, hirly_inventory_operator;

COMMIT;
