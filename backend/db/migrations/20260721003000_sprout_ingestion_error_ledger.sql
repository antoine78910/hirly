-- TS_MIGRATION: immutable diagnostic ledger for the TypeScript-owned Sprout writer.
BEGIN;

CREATE TABLE public.sprout_ingestion_errors (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  task_id uuid NOT NULL REFERENCES public.worker_tasks(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  source_id uuid REFERENCES public.career_sources(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  error_code text NOT NULL CHECK (length(error_code) BETWEEN 1 AND 128),
  error_message text NOT NULL CHECK (length(error_message) BETWEEN 1 AND 512),
  request_document jsonb NOT NULL CHECK (jsonb_typeof(request_document) = 'object'),
  response_document jsonb NOT NULL,
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  response_bytes integer CHECK (response_bytes IS NULL OR response_bytes >= 0),
  schema_diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(schema_diagnostics) = 'array'),
  CONSTRAINT sprout_ingestion_errors_response_budget CHECK (pg_column_size(response_document) <= 1048576)
);

CREATE INDEX sprout_ingestion_errors_task_observed_idx
  ON public.sprout_ingestion_errors (task_id, observed_at DESC);
CREATE INDEX sprout_ingestion_errors_source_observed_idx
  ON public.sprout_ingestion_errors (source_id, observed_at DESC);

CREATE FUNCTION worker_private.record_sprout_ingestion_error(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_source_id uuid,
  p_error_code text,
  p_error_message text,
  p_request_document jsonb,
  p_response_document jsonb,
  p_response_status integer,
  p_response_bytes integer,
  p_schema_diagnostics jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_run_id uuid;
  v_attempt_number integer;
BEGIN
  SELECT task.run_id, task.attempts
    INTO v_run_id, v_attempt_number
  FROM public.worker_tasks AS task
  JOIN public.worker_runs AS run ON run.id = task.run_id
  WHERE task.id = p_task_id
    AND task.provider = 'sprout'
    AND task.status = 'running'
    AND task.lease_token = p_lease_token
    AND task.claim_generation = p_claim_generation
    AND task.lease_owner = p_lease_owner
    AND task.lease_until > clock_timestamp()
    AND (p_source_id IS NULL OR run.career_source_id = p_source_id)
  FOR SHARE OF task, run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sprout error ledger lease is not current' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_request_document) <> 'object'
    OR jsonb_typeof(p_schema_diagnostics) <> 'array'
    OR pg_column_size(p_response_document) > 1048576
  THEN
    RAISE EXCEPTION 'invalid Sprout error ledger evidence' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sprout_ingestion_errors (
    task_id, run_id, source_id, attempt_number, error_code, error_message,
    request_document, response_document, response_status, response_bytes,
    schema_diagnostics
  ) VALUES (
    p_task_id, v_run_id, p_source_id, v_attempt_number, p_error_code,
    p_error_message, p_request_document, p_response_document,
    p_response_status, p_response_bytes, p_schema_diagnostics
  );
END
$$;

REVOKE ALL ON public.sprout_ingestion_errors FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.record_sprout_ingestion_error(
  uuid, uuid, bigint, text, uuid, text, text, jsonb, jsonb, integer, integer, jsonb
) FROM PUBLIC;
GRANT SELECT ON public.sprout_ingestion_errors TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.record_sprout_ingestion_error(
  uuid, uuid, bigint, text, uuid, text, text, jsonb, jsonb, integer, integer, jsonb
) TO hirly_inventory_worker;

COMMIT;
