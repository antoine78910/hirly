-- TS_MIGRATION: additive whole-provider ownership epochs and pre-fetch claims.
-- Applying this migration does not transfer provider ownership or enable a
-- provider, source, or schedule.
BEGIN;

ALTER TABLE public.provider_registry
  ADD COLUMN IF NOT EXISTS ownership_epoch bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT provider_registry_ownership_epoch_guard
    CHECK (ownership_epoch >= 0);

CREATE TABLE IF NOT EXISTS public.provider_work_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL
    REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  writer_runtime text NOT NULL
    CHECK (writer_runtime IN ('python', 'typescript')),
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  lease_owner text NOT NULL CHECK (length(btrim(lease_owner)) > 0),
  task_id uuid REFERENCES public.worker_tasks(id) ON DELETE RESTRICT,
  task_lease_token uuid,
  task_claim_generation bigint,
  expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_work_claims_task_shape CHECK (
    (writer_runtime = 'typescript'
      AND task_id IS NOT NULL
      AND task_lease_token IS NOT NULL
      AND task_claim_generation IS NOT NULL)
    OR
    (writer_runtime = 'python'
      AND task_id IS NULL
      AND task_lease_token IS NULL
      AND task_claim_generation IS NULL)
  ),
  CONSTRAINT provider_work_claims_expiry_guard CHECK (expires_at > created_at),
  CONSTRAINT provider_work_claims_finish_guard CHECK (
    finished_at IS NULL OR finished_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS provider_work_claims_live_provider_idx
  ON public.provider_work_claims(provider, ownership_epoch, expires_at)
  WHERE finished_at IS NULL;

CREATE OR REPLACE FUNCTION worker_private.provider_claim_is_current(
  p_claim_id uuid,
  p_runtime text,
  p_lease_owner text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.provider_work_claims AS claim
    JOIN public.provider_registry AS registry
      ON registry.provider = claim.provider
    WHERE claim.id = p_claim_id
      AND claim.writer_runtime = p_runtime
      AND (p_lease_owner IS NULL OR claim.lease_owner = p_lease_owner)
      AND claim.finished_at IS NULL
      AND claim.expires_at > clock_timestamp()
      AND registry.writer_runtime = claim.writer_runtime
      AND registry.ownership_epoch = claim.ownership_epoch
  )
$$;

CREATE OR REPLACE FUNCTION worker_private.transition_provider_writer(
  p_provider text,
  p_expected_runtime text,
  p_new_runtime text,
  p_expected_epoch bigint
)
RETURNS public.provider_registry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_provider public.provider_registry;
BEGIN
  IF p_expected_runtime NOT IN ('none', 'python', 'typescript')
    OR p_new_runtime NOT IN ('none', 'python', 'typescript')
    OR p_expected_runtime = p_new_runtime
  THEN
    RAISE EXCEPTION 'invalid provider writer transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
  FROM public.provider_registry
  WHERE provider = p_provider
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;
  IF v_provider.writer_runtime IS DISTINCT FROM p_expected_runtime
    OR v_provider.ownership_epoch IS DISTINCT FROM p_expected_epoch
  THEN
    RAISE EXCEPTION 'stale provider writer transition' USING ERRCODE = '40001';
  END IF;
  IF p_expected_runtime <> 'none' AND p_new_runtime <> 'none' THEN
    RAISE EXCEPTION 'provider writer must transition through none'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.provider_registry
  SET enabled = false,
      writer_runtime = p_new_runtime,
      ownership_epoch = ownership_epoch + 1,
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
  SELECT * INTO v_provider
  FROM public.provider_registry
  WHERE provider = p_provider
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;
  RETURN worker_private.transition_provider_writer(
    p_provider,
    v_provider.writer_runtime,
    p_writer_runtime,
    v_provider.ownership_epoch
  );
END
$$;

CREATE OR REPLACE FUNCTION worker_private.claim_provider_work(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_provider text,
  p_lease_seconds integer
)
RETURNS TABLE (
  claim_id uuid,
  provider text,
  runtime text,
  ownership_epoch bigint,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_epoch bigint;
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid provider claim duration' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.worker_tasks
  WHERE id = p_task_id
    AND provider = p_provider
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker task lease is not current' USING ERRCODE = '42501';
  END IF;

  SELECT registry.ownership_epoch INTO v_epoch
  FROM public.provider_registry AS registry
  WHERE registry.provider = p_provider
    AND registry.enabled
    AND registry.authorization_status = 'authorized'
    AND registry.writer_runtime = 'typescript'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider is not owned by TypeScript' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.provider_work_claims (
    provider, writer_runtime, ownership_epoch, lease_owner, task_id,
    task_lease_token, task_claim_generation, expires_at
  )
  VALUES (
    p_provider, 'typescript', v_epoch, p_lease_owner, p_task_id,
    p_lease_token, p_claim_generation,
    clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  RETURNING id, provider, writer_runtime, ownership_epoch, expires_at;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.write_jobs_and_complete(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_provider_claim_id uuid,
  p_jobs jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
BEGIN
  PERFORM 1
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  WHERE claim.id = p_provider_claim_id
    AND claim.writer_runtime = 'typescript'
    AND claim.task_id = p_task_id
    AND claim.task_lease_token = p_lease_token
    AND claim.task_claim_generation = p_claim_generation
    AND claim.lease_owner = p_lease_owner
    AND claim.finished_at IS NULL
    AND claim.expires_at > clock_timestamp()
    AND registry.writer_runtime = 'typescript'
    AND registry.ownership_epoch = claim.ownership_epoch
  FOR UPDATE OF claim, registry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider work claim is stale' USING ERRCODE = '42501';
  END IF;

  IF NOT worker_private.write_jobs_and_complete(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner, p_jobs
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE id = p_provider_claim_id AND finished_at IS NULL;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.python_provider_work_claim(
  p_provider text,
  p_lease_owner text,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_epoch bigint;
  v_claim public.provider_work_claims;
BEGIN
  IF length(btrim(p_lease_owner)) = 0
    OR p_lease_seconds NOT BETWEEN 1 AND 3600
  THEN
    RAISE EXCEPTION 'invalid Python provider claim' USING ERRCODE = '22023';
  END IF;

  SELECT ownership_epoch INTO v_epoch
  FROM public.provider_registry
  WHERE provider = p_provider
    AND writer_runtime = 'python'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider is not owned by Python' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.provider_work_claims (
    provider, writer_runtime, ownership_epoch, lease_owner, expires_at
  )
  VALUES (
    p_provider, 'python', v_epoch, p_lease_owner,
    clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'provider', v_claim.provider,
    'writer_runtime', v_claim.writer_runtime,
    'ownership_epoch', v_claim.ownership_epoch,
    'expires_at', v_claim.expires_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.python_provider_work_heartbeat(
  p_claim_id uuid,
  p_lease_owner text,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid provider claim duration' USING ERRCODE = '22023';
  END IF;
  IF NOT worker_private.provider_claim_is_current(
    p_claim_id, 'python', p_lease_owner
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_work_claims
  SET expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE id = p_claim_id
    AND lease_owner = p_lease_owner
    AND finished_at IS NULL;
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.python_provider_work_finish(
  p_claim_id uuid,
  p_lease_owner text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
BEGIN
  IF NOT worker_private.provider_claim_is_current(
    p_claim_id, 'python', p_lease_owner
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE id = p_claim_id
    AND lease_owner = p_lease_owner
    AND finished_at IS NULL;
  RETURN FOUND;
END
$$;

REVOKE ALL ON public.provider_work_claims FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, jsonb
) FROM hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.claim_provider_work(
  uuid, uuid, bigint, text, text, integer
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, uuid, jsonb
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.transition_provider_writer(
  text, text, text, bigint
) TO hirly_inventory_operator;

REVOKE ALL ON FUNCTION public.python_provider_work_claim(text, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_provider_work_heartbeat(uuid, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_provider_work_finish(uuid, text)
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.python_provider_work_claim(text, text, integer)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_provider_work_heartbeat(uuid, text, integer)
      TO service_role;
    GRANT EXECUTE ON FUNCTION public.python_provider_work_finish(uuid, text)
      TO service_role;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.jobs
      FROM service_role;
  END IF;
END
$$;

COMMIT;
