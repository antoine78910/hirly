-- TS_MIGRATION: additive whole-provider ownership epochs and pre-fetch claims.
-- Applying this migration does not transfer ownership of an existing provider
-- or enable a provider, source, or schedule. It establishes the disabled
-- Python-owner precondition for France Travail only when that row is absent.
BEGIN;

ALTER TABLE public.provider_registry
  ADD COLUMN IF NOT EXISTS ownership_epoch bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claims_required boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT provider_registry_ownership_epoch_guard
    CHECK (ownership_epoch >= 0);

-- Establish the owner required by the claim-aware Python France Travail paths
-- on a fresh schema. Keep both provider enablement and claim enforcement off:
-- provider_registry remains the ownership authority, while existing direct
-- Python writes are not broken until operators explicitly enable fencing after
-- verifying every France Travail writer uses the guarded RPC.
INSERT INTO public.provider_registry (
  provider, access_method, authorization_status, authorization_evidence_ref,
  enabled, writer_runtime, rate_limit_config, ownership_epoch, claims_required
)
VALUES (
  'france_travail', 'official-api', 'unverified', NULL,
  false, 'python', '{"requestsPerMinute":1,"concurrency":1}', 0, false
)
ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.provider_work_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL
    REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  captured_runtime text NOT NULL
    CHECK (captured_runtime IN ('python', 'typescript')),
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  lease_owner text NOT NULL CHECK (length(btrim(lease_owner)) > 0),
  task_id uuid REFERENCES public.worker_tasks(id) ON DELETE RESTRICT,
  task_lease_token uuid,
  task_claim_generation bigint,
  expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_work_claims_task_shape CHECK (
    (captured_runtime = 'typescript'
      AND task_id IS NOT NULL
      AND task_lease_token IS NOT NULL
      AND task_claim_generation IS NOT NULL)
    OR
    (captured_runtime = 'python'
      AND task_id IS NULL
      AND task_lease_token IS NULL
      AND task_claim_generation IS NULL)
  ),
  CONSTRAINT provider_work_claims_expiry_guard CHECK (expires_at > created_at),
  CONSTRAINT provider_work_claims_finish_guard CHECK (
    finished_at IS NULL OR finished_at >= created_at
  ),
  CONSTRAINT provider_work_claims_task_attempt_unique
    UNIQUE (task_id, task_lease_token, task_claim_generation, provider)
);

CREATE INDEX IF NOT EXISTS provider_work_claims_live_provider_idx
  ON public.provider_work_claims(provider, ownership_epoch, expires_at)
  WHERE finished_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS provider_work_claims_live_operation_unique
  ON public.provider_work_claims(provider, captured_runtime, lease_owner)
  WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS worker_private.provider_write_transactions (
  transaction_id bigint PRIMARY KEY,
  claim_id uuid NOT NULL
    REFERENCES public.provider_work_claims(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.enforce_provider_work_claim_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.id <> OLD.id
    OR NEW.provider <> OLD.provider
    OR NEW.captured_runtime <> OLD.captured_runtime
    OR NEW.ownership_epoch <> OLD.ownership_epoch
    OR NEW.lease_owner <> OLD.lease_owner
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.task_lease_token IS DISTINCT FROM OLD.task_lease_token
    OR NEW.task_claim_generation IS DISTINCT FROM OLD.task_claim_generation
    OR NEW.created_at <> OLD.created_at
    OR NEW.expires_at < OLD.expires_at
    OR OLD.finished_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'provider work claim history is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS provider_work_claims_immutable
  ON public.provider_work_claims;
CREATE TRIGGER provider_work_claims_immutable
BEFORE UPDATE OR DELETE ON public.provider_work_claims
FOR EACH ROW EXECUTE FUNCTION public.enforce_provider_work_claim_history();

CREATE OR REPLACE FUNCTION worker_private.enforce_claimed_provider_job_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_provider text := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.provider
    ELSE NEW.provider
  END;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.provider IS DISTINCT FROM NEW.provider
    AND EXISTS (
      SELECT 1
      FROM public.provider_registry
      WHERE provider IN (OLD.provider, NEW.provider)
        AND claims_required
    )
  THEN
    RAISE EXCEPTION 'claimed provider identity cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.provider_registry
    WHERE provider = v_provider
      AND claims_required
  ) AND NOT EXISTS (
    SELECT 1
    FROM worker_private.provider_write_transactions AS transaction_claim
    JOIN public.provider_work_claims AS claim
      ON claim.id = transaction_claim.claim_id
    JOIN public.provider_registry AS registry
      ON registry.provider = claim.provider
    WHERE transaction_claim.transaction_id = txid_current()
      AND transaction_claim.provider = v_provider
      AND claim.provider = v_provider
      AND claim.finished_at IS NULL
      AND claim.expires_at > clock_timestamp()
      AND registry.writer_runtime = claim.captured_runtime
      AND registry.ownership_epoch = claim.ownership_epoch
  ) THEN
    RAISE EXCEPTION 'claimed provider jobs require guarded RPC'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS jobs_claimed_provider_write_guard ON public.jobs;
CREATE TRIGGER jobs_claimed_provider_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION worker_private.enforce_claimed_provider_job_write();

CREATE OR REPLACE FUNCTION worker_private.provider_claim_is_current(
  p_claim_id uuid,
  p_runtime text,
  p_lease_owner text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.provider_work_claims AS claim
    JOIN public.provider_registry AS registry
      ON registry.provider = claim.provider
    WHERE claim.id = p_claim_id
      AND claim.captured_runtime = p_runtime
      AND (p_lease_owner IS NULL OR claim.lease_owner = p_lease_owner)
      AND claim.finished_at IS NULL
      AND claim.expires_at > clock_timestamp()
      AND registry.writer_runtime = claim.captured_runtime
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
SET search_path = pg_catalog
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
      claims_required = true,
      ownership_epoch = ownership_epoch + 1,
      updated_at = clock_timestamp()
  WHERE provider = p_provider
  RETURNING * INTO v_provider;
  RETURN v_provider;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.enable_provider_claim_enforcement(
  p_provider text
)
RETURNS public.provider_registry
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_provider public.provider_registry;
BEGIN
  UPDATE public.provider_registry
  SET claims_required = true,
      updated_at = clock_timestamp()
  WHERE provider = p_provider
  RETURNING * INTO v_provider;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider' USING ERRCODE = '23503';
  END IF;
  RETURN v_provider;
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
SET search_path = pg_catalog
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

  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE provider = p_provider
    AND captured_runtime = 'typescript'
    AND lease_owner = p_lease_owner
    AND finished_at IS NULL
    AND expires_at <= clock_timestamp();

  RETURN QUERY
  INSERT INTO public.provider_work_claims (
    provider, captured_runtime, ownership_epoch, lease_owner, task_id,
    task_lease_token, task_claim_generation, expires_at
  )
  VALUES (
    p_provider, 'typescript', v_epoch, p_lease_owner, p_task_id,
    p_lease_token, p_claim_generation,
    clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  RETURNING id, provider, captured_runtime, ownership_epoch, expires_at;
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
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  WHERE claim.id = p_provider_claim_id
    AND claim.captured_runtime = 'typescript'
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

  INSERT INTO worker_private.provider_write_transactions (
    transaction_id, claim_id, provider
  )
  SELECT txid_current(), claim.id, claim.provider
  FROM public.provider_work_claims AS claim
  WHERE claim.id = p_provider_claim_id;
  IF NOT worker_private.write_jobs_and_complete(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner, p_jobs
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE id = p_provider_claim_id AND finished_at IS NULL;
  DELETE FROM worker_private.provider_write_transactions
  WHERE transaction_id = txid_current();
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
SET search_path = pg_catalog
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
    provider, captured_runtime, ownership_epoch, lease_owner, expires_at
  )
  VALUES (
    p_provider, 'python', v_epoch, p_lease_owner,
    clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'provider', v_claim.provider,
    'writer_runtime', v_claim.captured_runtime,
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
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid provider claim duration' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  WHERE claim.id = p_claim_id
    AND claim.captured_runtime = 'python'
    AND claim.lease_owner = p_lease_owner
    AND claim.finished_at IS NULL
    AND claim.expires_at > clock_timestamp()
    AND registry.writer_runtime = 'python'
    AND registry.ownership_epoch = claim.ownership_epoch
  FOR UPDATE OF claim, registry;
  IF NOT FOUND THEN
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
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  WHERE claim.id = p_claim_id
    AND claim.captured_runtime = 'python'
    AND claim.lease_owner = p_lease_owner
    AND claim.finished_at IS NULL
    AND claim.expires_at > clock_timestamp()
    AND registry.writer_runtime = 'python'
    AND registry.ownership_epoch = claim.ownership_epoch
  FOR UPDATE OF claim, registry;
  IF NOT FOUND THEN
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

CREATE OR REPLACE FUNCTION public.python_provider_jobs_upsert(
  p_claim_id uuid,
  p_lease_owner text,
  p_jobs jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_provider text;
  v_written integer := 0;
  p_job jsonb;
  v_expected_job_id text;
  v_existing_job_id text;
  v_existing_provider text;
  v_existing_external_id text;
BEGIN
  SELECT claim.provider INTO v_provider
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  WHERE claim.id = p_claim_id
    AND claim.captured_runtime = 'python'
    AND claim.lease_owner = p_lease_owner
    AND claim.finished_at IS NULL
    AND claim.expires_at > clock_timestamp()
    AND registry.writer_runtime = 'python'
    AND registry.ownership_epoch = claim.ownership_epoch
  FOR UPDATE OF claim, registry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider work claim is stale' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_jobs) <> 'array'
    OR jsonb_array_length(p_jobs) = 0
    OR jsonb_array_length(p_jobs) > 500
  THEN
    RAISE EXCEPTION 'canonical batch must contain between 1 and 500 jobs'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO worker_private.provider_write_transactions (
    transaction_id, claim_id, provider
  )
  VALUES (txid_current(), p_claim_id, v_provider);

  FOR p_job IN SELECT value FROM jsonb_array_elements(p_jobs)
  LOOP
    IF p_job->>'provider' IS DISTINCT FROM v_provider
      OR coalesce(p_job->>'external_id', '') = ''
    THEN
      RAISE EXCEPTION 'job identity does not match provider claim'
        USING ERRCODE = '22023';
    END IF;
    v_expected_job_id := 'job_' || substr(
      encode(public.digest(v_provider || ':' || (p_job->>'external_id'), 'sha1'), 'hex'),
      1,
      16
    );
    IF p_job->>'job_id' IS DISTINCT FROM v_expected_job_id THEN
      RAISE EXCEPTION 'deterministic job id mismatch' USING ERRCODE = '23000';
    END IF;

    SELECT job_id INTO v_existing_job_id
    FROM public.jobs
    WHERE provider = v_provider
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
      v_existing_provider IS DISTINCT FROM v_provider
      OR v_existing_external_id IS DISTINCT FROM p_job->>'external_id'
    ) THEN
      RAISE EXCEPTION 'deterministic job id collision'
        USING ERRCODE = '23000';
    END IF;

    INSERT INTO public.jobs (
      job_id, provider, external_id, title, normalized_title, company,
      normalized_company, location, city, region, country_code, remote,
      salary_min, salary_max, currency, posted_at, provider_search_key,
      selected_apply_url, canonical_apply_url, ats_job_id,
      validation_status, validation_reason, validation_checked_at,
      applyability_tier, applyability_score, apply_fulfillment_status,
      apply_url_provider, ats_provider, requires_login,
      requires_account_creation, captcha_detected, manual_fulfillment_ready,
      auto_apply_supported, has_cv_upload, has_cover_letter,
      has_custom_questions, rejection_reason, fingerprint, data,
      imported_at, last_seen_at
    )
    VALUES (
      v_expected_job_id, v_provider, p_job->>'external_id', p_job->>'title',
      p_job->>'normalized_title', p_job->>'company',
      p_job->>'normalized_company', p_job->>'location',
      p_job->>'city', p_job->>'region', p_job->>'country_code',
      (p_job->>'remote')::boolean,
      (p_job->>'salary_min')::numeric, (p_job->>'salary_max')::numeric,
      p_job->>'currency', (p_job->>'posted_at')::timestamptz,
      p_job->>'provider_search_key', p_job->>'selected_apply_url',
      p_job->>'canonical_apply_url', p_job->>'ats_job_id',
      p_job->>'validation_status', p_job->>'validation_reason',
      (p_job->>'validation_checked_at')::timestamptz,
      p_job->>'applyability_tier',
      (p_job->>'applyability_score')::numeric,
      p_job->>'apply_fulfillment_status', p_job->>'apply_url_provider',
      p_job->>'ats_provider',
      coalesce((p_job->>'requires_login')::boolean, false),
      coalesce((p_job->>'requires_account_creation')::boolean, false),
      coalesce((p_job->>'captcha_detected')::boolean, false),
      coalesce((p_job->>'manual_fulfillment_ready')::boolean, false),
      coalesce((p_job->>'auto_apply_supported')::boolean, false),
      coalesce((p_job->>'has_cv_upload')::boolean, false),
      coalesce((p_job->>'has_cover_letter')::boolean, false),
      coalesce((p_job->>'has_custom_questions')::boolean, false),
      p_job->>'rejection_reason', p_job->>'fingerprint',
      coalesce(p_job->'data', '{}'::jsonb),
      clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT (job_id) DO UPDATE SET
      title = EXCLUDED.title,
      normalized_title = EXCLUDED.normalized_title,
      company = EXCLUDED.company,
      normalized_company = EXCLUDED.normalized_company,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      region = EXCLUDED.region,
      country_code = EXCLUDED.country_code,
      remote = EXCLUDED.remote,
      salary_min = EXCLUDED.salary_min,
      salary_max = EXCLUDED.salary_max,
      currency = EXCLUDED.currency,
      posted_at = EXCLUDED.posted_at,
      provider_search_key = EXCLUDED.provider_search_key,
      selected_apply_url = EXCLUDED.selected_apply_url,
      canonical_apply_url = EXCLUDED.canonical_apply_url,
      ats_job_id = EXCLUDED.ats_job_id,
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
      has_cv_upload = EXCLUDED.has_cv_upload,
      has_cover_letter = EXCLUDED.has_cover_letter,
      has_custom_questions = EXCLUDED.has_custom_questions,
      rejection_reason = EXCLUDED.rejection_reason,
      fingerprint = EXCLUDED.fingerprint,
      data = EXCLUDED.data,
      last_seen_at = EXCLUDED.last_seen_at;
    v_written := v_written + 1;
  END LOOP;
  DELETE FROM worker_private.provider_write_transactions
  WHERE transaction_id = txid_current();
  RETURN v_written;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.heartbeat_provider_work(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_claim_id uuid,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid provider claim duration' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  JOIN public.worker_tasks AS task
    ON task.id = claim.task_id
  WHERE claim.id = p_claim_id
    AND claim.captured_runtime = 'typescript'
    AND claim.task_id = p_task_id
    AND claim.task_lease_token = p_lease_token
    AND claim.task_claim_generation = p_claim_generation
    AND claim.lease_owner = p_lease_owner
    AND claim.finished_at IS NULL
    AND claim.expires_at > clock_timestamp()
    AND task.status = 'running'
    AND task.lease_token = p_lease_token
    AND task.claim_generation = p_claim_generation
    AND task.lease_owner = p_lease_owner
    AND task.lease_until > clock_timestamp()
    AND registry.writer_runtime = 'typescript'
    AND registry.ownership_epoch = claim.ownership_epoch
  FOR UPDATE OF claim, registry, task;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.provider_work_claims
  SET expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE id = p_claim_id AND finished_at IS NULL;
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.finish_provider_work(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_claim_id uuid,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public.provider_work_claims AS claim
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
  WHERE claim.id = p_claim_id
    AND claim.captured_runtime = 'typescript'
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
    RETURN false;
  END IF;
  IF NOT worker_private.finish_task(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner,
    p_outcome, p_error_code, p_error_message, p_retry_at
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE id = p_claim_id AND finished_at IS NULL;
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.release_provider_work(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_claim_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE id = p_claim_id
    AND captured_runtime = 'typescript'
    AND task_id = p_task_id
    AND task_lease_token = p_lease_token
    AND task_claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND finished_at IS NULL;
  RETURN FOUND;
END
$$;

REVOKE ALL ON public.provider_work_claims FROM PUBLIC;
REVOKE ALL ON worker_private.provider_write_transactions FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_work_claims
  FROM hirly_inventory_worker, hirly_inventory_operator;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON worker_private.provider_write_transactions
  FROM hirly_inventory_worker, hirly_inventory_operator;
REVOKE ALL ON FUNCTION public.enforce_provider_work_claim_history()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.enforce_claimed_provider_job_write()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.provider_claim_is_current(uuid, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.transition_provider_writer(text, text, text, bigint)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.enable_provider_claim_enforcement(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.claim_provider_work(uuid, uuid, bigint, text, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.write_jobs_and_complete(uuid, uuid, bigint, text, uuid, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.heartbeat_provider_work(uuid, uuid, bigint, text, uuid, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.finish_provider_work(
  uuid, uuid, bigint, text, uuid, text, text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.release_provider_work(
  uuid, uuid, bigint, text, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION worker_private.set_provider_writer(text, text)
  FROM hirly_inventory_operator;
REVOKE EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, jsonb
) FROM hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.claim_provider_work(
  uuid, uuid, bigint, text, text, integer
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, uuid, jsonb
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.heartbeat_provider_work(
  uuid, uuid, bigint, text, uuid, integer
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.finish_provider_work(
  uuid, uuid, bigint, text, uuid, text, text, text, timestamptz
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.release_provider_work(
  uuid, uuid, bigint, text, uuid
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.transition_provider_writer(
  text, text, text, bigint
) TO hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.enable_provider_claim_enforcement(text)
  TO hirly_inventory_operator;

REVOKE ALL ON FUNCTION public.python_provider_work_claim(text, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_provider_work_heartbeat(uuid, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_provider_work_finish(uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.python_provider_jobs_upsert(uuid, text, jsonb)
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
    GRANT EXECUTE ON FUNCTION public.python_provider_jobs_upsert(uuid, text, jsonb)
      TO service_role;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_work_claims
      FROM service_role;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON worker_private.provider_write_transactions
      FROM service_role;
  END IF;
END
$$;

COMMIT;
