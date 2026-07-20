-- Additive durable queue, schedule, and provider authorization foundation.
-- Apply to the same physical database as canonical public.jobs.
-- This migration does not enable a provider or move an existing writer.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_inventory_worker') THEN
    CREATE ROLE hirly_inventory_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_inventory_operator') THEN
    CREATE ROLE hirly_inventory_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_inventory_reader') THEN
    CREATE ROLE hirly_inventory_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.provider_registry (
  provider text PRIMARY KEY,
  access_method text NOT NULL CHECK (length(btrim(access_method)) > 0),
  authorization_status text NOT NULL
    CHECK (authorization_status IN ('unverified', 'authorized', 'blocked')),
  authorization_evidence_ref text,
  authorization_reviewed_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  writer_runtime text NOT NULL DEFAULT 'none'
    CHECK (writer_runtime IN ('none', 'python', 'typescript')),
  rate_limit_config jsonb NOT NULL DEFAULT '{"requestsPerMinute":1,"concurrency":1}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_registry_enablement_guard CHECK (
    NOT enabled OR (
      authorization_status = 'authorized'
      AND writer_runtime = 'typescript'
      AND authorization_evidence_ref IS NOT NULL
      AND authorization_reviewed_at IS NOT NULL
    )
  ),
  CONSTRAINT provider_registry_authorization_evidence_guard CHECK (
    authorization_status <> 'authorized'
    OR (
      authorization_evidence_ref IS NOT NULL
      AND authorization_reviewed_at IS NOT NULL
    )
  ),
  CONSTRAINT provider_registry_rate_limit_guard CHECK (
    jsonb_typeof(rate_limit_config) = 'object'
    AND (rate_limit_config->>'requestsPerMinute') ~ '^[1-9][0-9]*$'
    AND (rate_limit_config->>'concurrency') ~ '^[1-9][0-9]*$'
  )
);

CREATE TABLE IF NOT EXISTS public.worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('provider_ingestion', 'inventory_maintenance')),
  provider text REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  trigger_source text NOT NULL CHECK (trigger_source IN ('schedule', 'cli', 'http', 'system')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled')),
  schedule_id text,
  scheduled_for timestamptz,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_runs_kind_idempotency_unique UNIQUE (kind, idempotency_key),
  CONSTRAINT worker_runs_schedule_occurrence_pair CHECK (
    (schedule_id IS NULL) = (scheduled_for IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_runs_schedule_occurrence_unique
  ON public.worker_runs (schedule_id, scheduled_for)
  WHERE schedule_id IS NOT NULL AND scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.worker_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  task_key text NOT NULL CHECK (length(btrim(task_key)) > 0),
  task_type text NOT NULL CHECK (task_type IN ('provider.fetch_page', 'inventory.maintenance')),
  provider text REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retryable', 'succeeded', 'failed', 'cancelled')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  lease_owner text,
  lease_token uuid,
  claim_generation bigint NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_tasks_run_key_unique UNIQUE (run_id, task_key),
  CONSTRAINT worker_tasks_lease_shape CHECK (
    (
      status = 'running'
      AND lease_until IS NOT NULL
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
    )
    OR
    (
      status <> 'running'
      AND lease_until IS NULL
      AND lease_owner IS NULL
      AND lease_token IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS worker_tasks_ready_claim_idx
  ON public.worker_tasks (available_at, id)
  WHERE status IN ('queued', 'retryable');
CREATE INDEX IF NOT EXISTS worker_tasks_expired_lease_idx
  ON public.worker_tasks (lease_until, id)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS worker_tasks_provider_claim_idx
  ON public.worker_tasks (provider, available_at, id)
  WHERE status IN ('queued', 'retryable', 'running');

CREATE TABLE IF NOT EXISTS public.worker_task_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.worker_tasks(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  lease_token uuid NOT NULL,
  claim_generation bigint NOT NULL CHECK (claim_generation > 0),
  lease_owner text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_heartbeat_at timestamptz,
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('succeeded', 'retryable', 'failed', 'cancelled', 'lease_expired')),
  error_code text,
  error_message text,
  CONSTRAINT worker_task_attempts_number_unique UNIQUE (task_id, attempt_number),
  CONSTRAINT worker_task_attempts_lease_unique UNIQUE (task_id, lease_token, claim_generation)
);

CREATE OR REPLACE FUNCTION worker_private_enforce_attempt_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'worker task attempt history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.task_id <> OLD.task_id
    OR NEW.attempt_number <> OLD.attempt_number
    OR NEW.lease_token <> OLD.lease_token
    OR NEW.claim_generation <> OLD.claim_generation
    OR NEW.lease_owner <> OLD.lease_owner
    OR NEW.claimed_at <> OLD.claimed_at
    OR OLD.finished_at IS NOT NULL
    OR (OLD.last_heartbeat_at IS NOT NULL AND NEW.last_heartbeat_at < OLD.last_heartbeat_at)
  THEN
    RAISE EXCEPTION 'immutable worker task attempt fields cannot be changed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS worker_task_attempts_immutable ON public.worker_task_attempts;
CREATE TRIGGER worker_task_attempts_immutable
BEFORE UPDATE OR DELETE ON public.worker_task_attempts
FOR EACH ROW EXECUTE FUNCTION worker_private_enforce_attempt_history();

CREATE TABLE IF NOT EXISTS public.worker_schedules (
  id text PRIMARY KEY,
  task_type text NOT NULL CHECK (task_type IN ('provider.fetch_page', 'inventory.maintenance')),
  provider text REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  cron_expression text NOT NULL CHECK (length(btrim(cron_expression)) > 0),
  timezone text NOT NULL DEFAULT 'UTC' CHECK (length(btrim(timezone)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  next_due_at timestamptz,
  last_enqueued_at timestamptz,
  max_catch_up integer NOT NULL DEFAULT 1 CHECK (max_catch_up BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_schedules_enabled_due_guard CHECK (NOT enabled OR next_due_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS worker_schedules_due_idx
  ON public.worker_schedules (next_due_at, id)
  WHERE enabled;

CREATE OR REPLACE VIEW public.worker_capability_status
WITH (security_barrier = true)
AS
SELECT
  'worker-foundation.v1'::text AS contract_version,
  count(*) FILTER (WHERE authorization_status = 'authorized')::integer AS authorized_providers,
  count(*) FILTER (WHERE enabled)::integer AS enabled_providers,
  count(*) FILTER (WHERE writer_runtime = 'typescript')::integer AS typescript_owned_providers
FROM public.provider_registry;

CREATE SCHEMA IF NOT EXISTS worker_private;
REVOKE ALL ON SCHEMA worker_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION worker_private.refresh_run_status(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_total integer;
  v_succeeded integer;
  v_terminal integer;
  v_failed integer;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'succeeded'),
    count(*) FILTER (WHERE status IN ('succeeded', 'failed', 'cancelled')),
    count(*) FILTER (WHERE status IN ('failed', 'cancelled'))
  INTO v_total, v_succeeded, v_terminal, v_failed
  FROM public.worker_tasks
  WHERE run_id = p_run_id;

  UPDATE public.worker_runs
  SET
    status = CASE
      WHEN v_total = 0 THEN status
      WHEN v_terminal < v_total THEN 'running'
      WHEN v_succeeded = v_total THEN 'succeeded'
      WHEN v_succeeded > 0 AND v_failed > 0 THEN 'partially_succeeded'
      ELSE 'failed'
    END,
    started_at = CASE WHEN v_total > 0 THEN coalesce(started_at, clock_timestamp()) ELSE started_at END,
    finished_at = CASE WHEN v_total > 0 AND v_terminal = v_total THEN clock_timestamp() ELSE NULL END,
    heartbeat_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_run_id;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.enqueue_run(
  p_kind text,
  p_provider text,
  p_idempotency_key text,
  p_trigger_source text,
  p_task_key text,
  p_task_type text,
  p_payload jsonb,
  p_max_attempts integer DEFAULT 5,
  p_available_at timestamptz DEFAULT clock_timestamp(),
  p_schedule_id text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT NULL
)
RETURNS public.worker_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_run public.worker_runs;
BEGIN
  IF p_provider IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provider_registry WHERE provider = p_provider
  ) THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.worker_runs (
    kind, provider, idempotency_key, trigger_source, schedule_id, scheduled_for
  )
  VALUES (
    p_kind, p_provider, p_idempotency_key, p_trigger_source, p_schedule_id, p_scheduled_for
  )
  ON CONFLICT (kind, idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO v_run;

  INSERT INTO public.worker_tasks (
    run_id, task_key, task_type, provider, payload, available_at, max_attempts
  )
  VALUES (
    v_run.id, p_task_key, p_task_type, p_provider, coalesce(p_payload, '{}'::jsonb),
    p_available_at, p_max_attempts
  )
  ON CONFLICT (run_id, task_key) DO NOTHING;

  RETURN v_run;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.claim_tasks(
  p_lease_owner text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS SETOF public.worker_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_reaped integer;
  v_reaped_run_ids uuid[];
  v_reaped_run_id uuid;
BEGIN
  IF length(btrim(p_lease_owner)) = 0 OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid claim parameters' USING ERRCODE = '22023';
  END IF;

  WITH exhausted AS (
    UPDATE public.worker_tasks
    SET
      status = 'failed',
      lease_until = NULL,
      lease_owner = NULL,
      lease_token = NULL,
      last_error_code = 'retry_exhausted',
      last_error_message = 'lease expired after maximum attempts',
      updated_at = clock_timestamp()
    WHERE status = 'running'
      AND lease_until <= clock_timestamp()
      AND attempts >= max_attempts
    RETURNING id, run_id, claim_generation
  ),
  finished_attempts AS (
    UPDATE public.worker_task_attempts AS attempt
    SET
      finished_at = clock_timestamp(),
      outcome = 'lease_expired',
      error_code = 'retry_exhausted',
      error_message = 'lease expired after maximum attempts'
    FROM exhausted
    WHERE attempt.task_id = exhausted.id
      AND attempt.claim_generation = exhausted.claim_generation
      AND attempt.finished_at IS NULL
    RETURNING exhausted.run_id
  )
  SELECT count(*), array_agg(DISTINCT run_id)
  INTO v_reaped, v_reaped_run_ids
  FROM finished_attempts;

  FOREACH v_reaped_run_id IN ARRAY coalesce(v_reaped_run_ids, ARRAY[]::uuid[])
  LOOP
    PERFORM worker_private.refresh_run_status(v_reaped_run_id);
  END LOOP;

  RETURN QUERY
  WITH candidates AS (
    SELECT task.id, task.status AS prior_status, task.claim_generation AS prior_generation
    FROM public.worker_tasks AS task
    LEFT JOIN public.provider_registry AS registry
      ON registry.provider = task.provider
    WHERE
      task.attempts < task.max_attempts
      AND (
        (task.status IN ('queued', 'retryable') AND task.available_at <= clock_timestamp())
        OR
        (task.status = 'running' AND task.lease_until <= clock_timestamp())
      )
      AND (
        task.provider IS NULL
        OR (
          registry.enabled
          AND registry.authorization_status = 'authorized'
          AND registry.writer_runtime = 'typescript'
        )
      )
    ORDER BY task.available_at, task.id
    FOR UPDATE OF task SKIP LOCKED
    LIMIT p_limit
  ),
  expired_attempts AS (
    UPDATE public.worker_task_attempts AS attempt
    SET
      finished_at = clock_timestamp(),
      outcome = 'lease_expired',
      error_code = 'lease_expired',
      error_message = 'lease expired and task was reclaimed'
    FROM candidates
    WHERE candidates.prior_status = 'running'
      AND attempt.task_id = candidates.id
      AND attempt.claim_generation = candidates.prior_generation
      AND attempt.finished_at IS NULL
    RETURNING attempt.task_id
  ),
  claimed AS (
    UPDATE public.worker_tasks AS task
    SET
      status = 'running',
      lease_owner = p_lease_owner,
      lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      claim_generation = task.claim_generation + 1,
      attempts = task.attempts + 1,
      updated_at = clock_timestamp()
    FROM candidates
    WHERE task.id = candidates.id
    RETURNING task.*
  ),
  attempts AS (
    INSERT INTO public.worker_task_attempts (
      task_id, attempt_number, lease_token, claim_generation, lease_owner
    )
    SELECT id, attempts, lease_token, claim_generation, lease_owner
    FROM claimed
    RETURNING task_id
  )
  SELECT claimed.*
  FROM claimed
  JOIN attempts ON attempts.task_id = claimed.id
  LEFT JOIN expired_attempts ON expired_attempts.task_id = claimed.id;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.set_schedule_enabled(
  p_schedule_id text,
  p_enabled boolean,
  p_next_due_at timestamptz DEFAULT NULL
)
RETURNS public.worker_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_schedule public.worker_schedules;
BEGIN
  SELECT * INTO v_schedule
  FROM public.worker_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown schedule' USING ERRCODE = '23503';
  END IF;
  IF p_enabled AND coalesce(p_next_due_at, v_schedule.next_due_at) IS NULL THEN
    RAISE EXCEPTION 'enabled schedule requires next due time' USING ERRCODE = '22023';
  END IF;

  UPDATE public.worker_schedules
  SET
    enabled = p_enabled,
    next_due_at = CASE WHEN p_enabled THEN coalesce(p_next_due_at, next_due_at) ELSE next_due_at END,
    updated_at = clock_timestamp()
  WHERE id = p_schedule_id
  RETURNING * INTO v_schedule;
  RETURN v_schedule;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.enqueue_due_schedule(
  p_schedule_id text,
  p_next_due_at timestamptz
)
RETURNS public.worker_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_schedule public.worker_schedules;
  v_run public.worker_runs;
  v_scheduled_for timestamptz;
BEGIN
  SELECT * INTO v_schedule
  FROM public.worker_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown schedule' USING ERRCODE = '23503';
  END IF;
  IF NOT v_schedule.enabled OR v_schedule.next_due_at > clock_timestamp() THEN
    RETURN NULL;
  END IF;
  IF p_next_due_at <= v_schedule.next_due_at THEN
    RAISE EXCEPTION 'next due time must advance' USING ERRCODE = '22023';
  END IF;

  IF v_schedule.provider IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.provider_registry
    WHERE provider = v_schedule.provider
      AND enabled
      AND authorization_status = 'authorized'
      AND writer_runtime = 'typescript'
  ) THEN
    RETURN NULL;
  END IF;

  v_scheduled_for := v_schedule.next_due_at;
  SELECT * INTO v_run
  FROM worker_private.enqueue_run(
    CASE WHEN v_schedule.provider IS NULL THEN 'inventory_maintenance' ELSE 'provider_ingestion' END,
    v_schedule.provider,
    'schedule:' || v_schedule.id || ':' || to_char(v_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'schedule',
    'occurrence:' || to_char(v_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    v_schedule.task_type,
    v_schedule.payload,
    5,
    clock_timestamp(),
    v_schedule.id,
    v_scheduled_for
  );

  UPDATE public.worker_schedules
  SET
    last_enqueued_at = v_scheduled_for,
    next_due_at = p_next_due_at,
    updated_at = clock_timestamp()
  WHERE id = p_schedule_id;
  RETURN v_run;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.heartbeat_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_lease_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid heartbeat lease duration' USING ERRCODE = '22023';
  END IF;
  UPDATE public.worker_tasks
  SET lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE id = p_task_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE public.worker_task_attempts
    SET last_heartbeat_at = clock_timestamp()
    WHERE task_id = p_task_id
      AND lease_token = p_lease_token
      AND claim_generation = p_claim_generation;
  END IF;
  RETURN v_updated = 1;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.upsert_schedule(
  p_id text,
  p_task_type text,
  p_provider text,
  p_cron_expression text,
  p_timezone text,
  p_payload jsonb,
  p_next_due_at timestamptz,
  p_max_catch_up integer DEFAULT 1
)
RETURNS public.worker_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_schedule public.worker_schedules;
BEGIN
  IF length(btrim(p_id)) = 0
    OR p_task_type NOT IN ('provider.fetch_page', 'inventory.maintenance')
    OR cardinality(regexp_split_to_array(btrim(p_cron_expression), '\s+')) <> 5
    OR p_max_catch_up NOT BETWEEN 0 AND 10
  THEN
    RAISE EXCEPTION 'invalid schedule configuration' USING ERRCODE = '22023';
  END IF;
  IF (p_task_type = 'provider.fetch_page') <> (p_provider IS NOT NULL) THEN
    RAISE EXCEPTION 'provider task schedule/provider mismatch' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'unknown IANA timezone' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.worker_schedules (
    id, task_type, provider, cron_expression, timezone, payload,
    enabled, next_due_at, max_catch_up
  )
  VALUES (
    p_id, p_task_type, p_provider, p_cron_expression, p_timezone,
    coalesce(p_payload, '{}'::jsonb), false, p_next_due_at, p_max_catch_up
  )
  ON CONFLICT (id) DO UPDATE SET
    task_type = EXCLUDED.task_type,
    provider = EXCLUDED.provider,
    cron_expression = EXCLUDED.cron_expression,
    timezone = EXCLUDED.timezone,
    payload = EXCLUDED.payload,
    next_due_at = EXCLUDED.next_due_at,
    max_catch_up = EXCLUDED.max_catch_up,
    updated_at = clock_timestamp()
  RETURNING * INTO v_schedule;
  RETURN v_schedule;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.finish_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_run_id uuid;
  v_attempts integer;
  v_max_attempts integer;
  v_status text;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'retryable', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid terminal outcome' USING ERRCODE = '22023';
  END IF;

  SELECT run_id, attempts, max_attempts
  INTO v_run_id, v_attempts, v_max_attempts
  FROM public.worker_tasks
  WHERE id = p_task_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_status := CASE
    WHEN p_outcome = 'retryable' AND v_attempts >= v_max_attempts THEN 'failed'
    ELSE p_outcome
  END;

  UPDATE public.worker_tasks
  SET
    status = v_status,
    available_at = CASE
      WHEN v_status = 'retryable' THEN coalesce(p_retry_at, clock_timestamp())
      ELSE available_at
    END,
    lease_until = NULL,
    lease_owner = NULL,
    lease_token = NULL,
    last_error_code = p_error_code,
    last_error_message = p_error_message,
    updated_at = clock_timestamp()
  WHERE id = p_task_id;

  UPDATE public.worker_task_attempts
  SET
    finished_at = clock_timestamp(),
    outcome = CASE
      WHEN p_outcome = 'retryable' AND v_attempts >= v_max_attempts THEN 'failed'
      ELSE p_outcome
    END,
    error_code = p_error_code,
    error_message = p_error_message
  WHERE task_id = p_task_id
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND finished_at IS NULL;

  PERFORM worker_private.refresh_run_status(v_run_id);
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.set_provider_authorization(
  p_provider text,
  p_authorization_status text,
  p_evidence_ref text,
  p_reviewed_at timestamptz
)
RETURNS public.provider_registry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_provider public.provider_registry;
BEGIN
  IF p_authorization_status NOT IN ('unverified', 'authorized', 'blocked') THEN
    RAISE EXCEPTION 'invalid authorization status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
  FROM public.provider_registry
  WHERE provider = p_provider
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;

  UPDATE public.provider_registry
  SET
    enabled = CASE WHEN p_authorization_status = 'authorized' THEN enabled ELSE false END,
    authorization_status = p_authorization_status,
    authorization_evidence_ref = p_evidence_ref,
    authorization_reviewed_at = p_reviewed_at,
    updated_at = clock_timestamp()
  WHERE provider = p_provider
  RETURNING * INTO v_provider;
  RETURN v_provider;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.set_provider_writer(
  p_provider text,
  p_writer_runtime text
)
RETURNS public.provider_registry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_provider public.provider_registry;
BEGIN
  IF p_writer_runtime NOT IN ('none', 'python', 'typescript') THEN
    RAISE EXCEPTION 'invalid writer runtime' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider FROM public.provider_registry
  WHERE provider = p_provider FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;

  UPDATE public.provider_registry
  SET
    enabled = CASE WHEN p_writer_runtime = 'typescript' THEN enabled ELSE false END,
    writer_runtime = p_writer_runtime,
    updated_at = clock_timestamp()
  WHERE provider = p_provider
  RETURNING * INTO v_provider;
  RETURN v_provider;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.set_provider_enabled(
  p_provider text,
  p_enabled boolean
)
RETURNS public.provider_registry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_provider public.provider_registry;
BEGIN
  SELECT * INTO v_provider
  FROM public.provider_registry
  WHERE provider = p_provider
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;
  IF p_enabled AND (
    v_provider.authorization_status <> 'authorized'
    OR v_provider.writer_runtime <> 'typescript'
  ) THEN
    RAISE EXCEPTION 'provider is not authorized for TypeScript ownership'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.provider_registry
  SET enabled = p_enabled, updated_at = clock_timestamp()
  WHERE provider = p_provider
  RETURNING * INTO v_provider;
  RETURN v_provider;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.write_jobs_and_complete(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_jobs jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_task public.worker_tasks;
  p_job jsonb;
  v_expected_job_id text;
  v_existing_job_id text;
  v_existing_provider text;
  v_existing_external_id text;
BEGIN
  IF jsonb_typeof(p_jobs) <> 'array' OR jsonb_array_length(p_jobs) = 0
    OR jsonb_array_length(p_jobs) > 500 THEN
    RAISE EXCEPTION 'canonical batch must contain between 1 and 500 jobs'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_task
  FROM public.worker_tasks
  WHERE id = p_task_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_task.provider IS NULL THEN
    RAISE EXCEPTION 'canonical writes require a provider task' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.provider_registry
  WHERE provider = v_task.provider
    AND enabled
    AND authorization_status = 'authorized'
    AND writer_runtime = 'typescript'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider authorization or writer ownership changed'
      USING ERRCODE = '42501';
  END IF;

  FOR p_job IN SELECT value FROM jsonb_array_elements(p_jobs)
  LOOP
    IF p_job->>'provider' IS DISTINCT FROM v_task.provider
      OR coalesce(p_job->>'external_id', '') = '' THEN
      RAISE EXCEPTION 'job identity does not match leased provider task'
        USING ERRCODE = '22023';
    END IF;

    v_expected_job_id := 'job_' || substr(
      encode(digest((p_job->>'provider') || ':' || (p_job->>'external_id'), 'sha1'), 'hex'),
      1,
      16
    );
    IF p_job->>'job_id' IS DISTINCT FROM v_expected_job_id THEN
      RAISE EXCEPTION 'deterministic job id mismatch' USING ERRCODE = '23000';
    END IF;

    SELECT job_id INTO v_existing_job_id
    FROM public.jobs
    WHERE provider = p_job->>'provider'
      AND external_id = p_job->>'external_id'
    FOR UPDATE;
    IF FOUND AND v_existing_job_id <> v_expected_job_id THEN
      RAISE EXCEPTION 'existing provider identity maps to another job id'
        USING ERRCODE = '23000';
    END IF;

    SELECT provider, external_id
    INTO v_existing_provider, v_existing_external_id
    FROM public.jobs
    WHERE job_id = v_expected_job_id
    FOR UPDATE;
    IF FOUND AND (
      v_existing_provider IS DISTINCT FROM p_job->>'provider'
      OR v_existing_external_id IS DISTINCT FROM p_job->>'external_id'
    ) THEN
      RAISE EXCEPTION 'deterministic job id collision with another provider identity'
        USING ERRCODE = '23000';
    END IF;

    INSERT INTO public.jobs (
      job_id, provider, external_id, title, normalized_title, company,
      normalized_company, location, country_code, selected_apply_url,
      validation_status, validation_reason, validation_checked_at,
      applyability_tier, applyability_score, apply_fulfillment_status,
      apply_url_provider, ats_provider, requires_login,
      requires_account_creation, captcha_detected, manual_fulfillment_ready,
      auto_apply_supported, rejection_reason, fingerprint, data,
      imported_at, last_seen_at
    )
    VALUES (
      v_expected_job_id,
      p_job->>'provider',
      p_job->>'external_id',
      p_job->>'title',
      p_job->>'normalized_title',
      p_job->>'company',
      p_job->>'normalized_company',
      p_job->>'location',
      p_job->>'country_code',
      p_job->>'selected_apply_url',
      p_job->>'validation_status',
      p_job->>'validation_reason',
      (p_job->>'validation_checked_at')::timestamptz,
      p_job->>'applyability_tier',
      (p_job->>'applyability_score')::numeric,
      p_job->>'apply_fulfillment_status',
      p_job->>'apply_url_provider',
      p_job->>'ats_provider',
      coalesce((p_job->>'requires_login')::boolean, false),
      coalesce((p_job->>'requires_account_creation')::boolean, false),
      coalesce((p_job->>'captcha_detected')::boolean, false),
      coalesce((p_job->>'manual_fulfillment_ready')::boolean, false),
      coalesce((p_job->>'auto_apply_supported')::boolean, false),
      p_job->>'rejection_reason',
      p_job->>'fingerprint',
      coalesce(p_job->'data', '{}'::jsonb),
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT (job_id) DO UPDATE SET
      title = EXCLUDED.title,
      normalized_title = EXCLUDED.normalized_title,
      company = EXCLUDED.company,
      normalized_company = EXCLUDED.normalized_company,
      location = EXCLUDED.location,
      country_code = EXCLUDED.country_code,
      selected_apply_url = EXCLUDED.selected_apply_url,
      validation_status = EXCLUDED.validation_status,
      validation_reason = EXCLUDED.validation_reason,
      validation_checked_at = EXCLUDED.validation_checked_at,
      applyability_tier = EXCLUDED.applyability_tier,
      applyability_score = EXCLUDED.applyability_score,
      apply_fulfillment_status = EXCLUDED.apply_fulfillment_status,
      apply_url_provider = EXCLUDED.apply_url_provider,
      ats_provider = EXCLUDED.ats_provider,
      requires_login = EXCLUDED.requires_login,
      requires_account_creation = EXCLUDED.requires_account_creation,
      captcha_detected = EXCLUDED.captcha_detected,
      manual_fulfillment_ready = EXCLUDED.manual_fulfillment_ready,
      auto_apply_supported = EXCLUDED.auto_apply_supported,
      rejection_reason = EXCLUDED.rejection_reason,
      fingerprint = EXCLUDED.fingerprint,
      data = EXCLUDED.data,
      last_seen_at = EXCLUDED.last_seen_at;
  END LOOP;

  RETURN worker_private.finish_task(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner, 'succeeded'
  );
END
$$;

CREATE OR REPLACE FUNCTION worker_private.write_job_and_complete(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_job jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT worker_private.write_jobs_and_complete(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner,
    jsonb_build_array(p_job)
  )
$$;

REVOKE ALL ON public.provider_registry, public.worker_runs, public.worker_tasks,
  public.worker_task_attempts, public.worker_schedules FROM PUBLIC;
REVOKE ALL ON public.worker_capability_status FROM PUBLIC;
GRANT SELECT ON public.worker_capability_status TO hirly_inventory_reader;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA worker_private FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA worker_private FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA worker_private FROM authenticated;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA worker_private TO hirly_inventory_worker, hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.enqueue_run(
  text, text, text, text, text, text, jsonb, integer, timestamptz, text, timestamptz
) TO hirly_inventory_worker, hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.claim_tasks(text, integer, integer)
  TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.heartbeat_task(uuid, uuid, bigint, text, integer)
  TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.finish_task(
  uuid, uuid, bigint, text, text, text, text, timestamptz
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.write_job_and_complete(
  uuid, uuid, bigint, text, jsonb
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, jsonb
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.set_provider_authorization(
  text, text, text, timestamptz
) TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.set_provider_writer(text, text)
  TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.set_provider_enabled(text, boolean)
  TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.set_schedule_enabled(text, boolean, timestamptz)
  TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.upsert_schedule(
  text, text, text, text, text, jsonb, timestamptz, integer
) TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.enqueue_due_schedule(text, timestamptz)
  TO hirly_inventory_worker;

INSERT INTO public.provider_registry (
  provider, access_method, authorization_status, authorization_evidence_ref,
  enabled, writer_runtime, rate_limit_config
)
VALUES
  ('apec', 'not-yet-verified', 'unverified', NULL, false, 'none', '{"requestsPerMinute":1,"concurrency":1}'),
  ('hellowork', 'not-yet-verified', 'unverified', NULL, false, 'none', '{"requestsPerMinute":1,"concurrency":1}'),
  ('wttj', 'written-permission-or-approved-feed-required', 'blocked', NULL, false, 'none', '{"requestsPerMinute":1,"concurrency":1}'),
  ('indeed', 'approved-partner-api-required', 'blocked', NULL, false, 'none', '{"requestsPerMinute":1,"concurrency":1}')
ON CONFLICT (provider) DO NOTHING;

COMMIT;
