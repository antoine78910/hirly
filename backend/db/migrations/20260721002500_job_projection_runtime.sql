-- TS_NEW: disabled job search-document projection runtime.
-- Canonical inventory remains read-only to the projector. Only the derived
-- document and projection task/audit surfaces are mutable through these RPCs.
BEGIN;

ALTER TABLE public.projection_reconciliation_tasks
  ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0
    CHECK (claim_generation >= 0),
  ADD COLUMN IF NOT EXISTS source_digest text
    CHECK (source_digest IS NULL OR source_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS last_error_message text;

ALTER TABLE public.job_search_documents
  ADD COLUMN IF NOT EXISTS source_content_hash text
    CHECK (source_content_hash IS NULL OR source_content_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS source_snapshot_digest text
    CHECK (source_snapshot_digest IS NULL OR source_snapshot_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

CREATE TABLE public.job_projection_task_audit (
  task_id uuid NOT NULL REFERENCES public.projection_reconciliation_tasks(task_id)
    ON DELETE RESTRICT,
  claim_generation bigint NOT NULL CHECK (claim_generation > 0),
  task_kind text NOT NULL CHECK (
    task_kind IN ('job.document.project', 'projection.reconcile')
  ),
  entity_id text NOT NULL,
  entity_version bigint NOT NULL CHECK (entity_version > 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  outcome text NOT NULL CHECK (
    outcome IN ('succeeded', 'retryable', 'failed', 'stale_ignored', 'removed')
  ),
  result_digest text CHECK (
    result_digest IS NULL OR result_digest ~ '^[0-9a-f]{64}$'
  ),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error_code text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (task_id, claim_generation)
);

CREATE INDEX job_projection_task_audit_entity_idx
  ON public.job_projection_task_audit
    (entity_id, entity_version DESC, recorded_at DESC);

CREATE OR REPLACE FUNCTION worker_private.job_projection_source_digest(
  p_canonical_group_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT encode(digest(convert_to(coalesce((
    SELECT jsonb_build_object(
      'canonicalGroupId', group_row.id::text,
      'preferredJobId', group_row.preferred_job_id,
      'groupStatus', group_row.status,
      'title', job.title,
      'normalizedTitle', job.normalized_title,
      'company', job.company,
      'location', job.location,
      'countryCode', job.country_code,
      'remote', job.remote,
      'latitude', job.data->'latitude',
      'longitude', job.data->'longitude',
      'publishedAt', coalesce(occurrence.published_at, job.posted_at),
      'importedAt', job.imported_at,
      'firstSeenAt', coalesce(occurrence.first_seen_at, job.first_seen_at),
      'lastSeenAt', coalesce(occurrence.last_seen_at, job.last_seen_at),
      'expiresAt', coalesce(occurrence.expires_at, job.expires_at),
      'lifecycleState', coalesce(occurrence.lifecycle_state, job.lifecycle_state),
      'validationStatus', job.validation_status,
      'applyabilityTier', job.applyability_tier,
      'applyFulfillmentStatus', job.apply_fulfillment_status,
      'autoApplySupported', job.auto_apply_supported,
      'manualFulfillmentReady', job.manual_fulfillment_ready,
      'sourceEligible', source.enabled,
      'policyEligible', occurrence.policy_id IS NOT NULL,
      -- The projector reads normalized role/location/contract/skill facts from
      -- this complete canonical source document. Including all of it ensures a
      -- projected-field-only mutation cannot evade reconciliation.
      'data', job.data
    )
    FROM public.canonical_job_groups AS group_row
    LEFT JOIN public.jobs AS job ON job.job_id = group_row.preferred_job_id
    LEFT JOIN public.job_occurrences AS occurrence ON occurrence.job_id = job.job_id
    LEFT JOIN public.career_sources AS source ON source.id = occurrence.source_id
    WHERE group_row.id = p_canonical_group_id
  ), jsonb_build_object(
    'canonicalGroupId', p_canonical_group_id::text,
    'missing', true
  ))::text, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION worker_private.enqueue_current_job_projection_task(
  p_canonical_group_id uuid,
  p_source_digest text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_digest text := coalesce(
    p_source_digest,
    worker_private.job_projection_source_digest(p_canonical_group_id)
  );
  v_version bigint;
  v_inserted integer;
BEGIN
  IF v_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid projection source digest' USING ERRCODE = '22023';
  END IF;
  SELECT greatest(
    coalesce((SELECT job_version FROM public.job_search_documents
      WHERE canonical_group_id = p_canonical_group_id), 0),
    coalesce((SELECT max(entity_version)
      FROM public.projection_reconciliation_tasks
      WHERE task_kind = 'job.document.project'
        AND entity_id = p_canonical_group_id::text), 0)
  ) + 1 INTO v_version;
  INSERT INTO public.projection_reconciliation_tasks (
    task_kind, entity_id, entity_version, idempotency_key, source_digest
  ) VALUES (
    'job.document.project', p_canonical_group_id::text, v_version,
    'job-source:' || p_canonical_group_id::text || ':' || v_version::text || ':' || v_digest,
    v_digest
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.claim_job_projection_tasks(
  p_lease_owner text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  task_id uuid,
  task_kind text,
  entity_id text,
  entity_version bigint,
  idempotency_key text,
  lease_owner text,
  lease_token uuid,
  claim_generation bigint,
  source_digest text,
  lease_until timestamptz,
  attempts integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF length(btrim(coalesce(p_lease_owner, ''))) = 0
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 5 AND 3600
  THEN
    RAISE EXCEPTION 'invalid job projection claim parameters'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.projection_reconciliation_tasks AS task
  SET status = 'failed',
      lease_owner = NULL,
      lease_token = NULL,
      lease_until = NULL,
      last_error_code = 'retry_exhausted',
      last_error_message = 'expired lease exhausted projection attempts',
      updated_at = clock_timestamp()
  WHERE task.task_kind IN ('job.document.project', 'projection.reconcile')
    AND task.status = 'running'
    AND task.lease_until <= clock_timestamp()
    AND task.attempts >= task.max_attempts;

  RETURN QUERY
  WITH candidates AS (
    SELECT task.task_id
    FROM public.projection_reconciliation_tasks AS task
    WHERE task.task_kind IN ('job.document.project', 'projection.reconcile')
      AND task.attempts < task.max_attempts
      AND (
        (task.status IN ('queued', 'retryable')
          AND task.available_at <= clock_timestamp())
        OR (task.status = 'running' AND task.lease_until <= clock_timestamp())
      )
      AND (
        (task.task_kind = 'job.document.project' AND EXISTS (
          SELECT 1 FROM public.matching_runtime_controls AS control
          WHERE control.capability = 'job_projection' AND control.enabled
        ))
        OR (task.task_kind = 'projection.reconcile' AND EXISTS (
          SELECT 1 FROM public.matching_runtime_controls AS control
          WHERE control.capability = 'projection_reconciliation' AND control.enabled
        ))
      )
    ORDER BY task.available_at, task.task_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.projection_reconciliation_tasks AS task
  SET status = 'running',
      lease_owner = p_lease_owner,
      lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      claim_generation = task.claim_generation + 1,
      attempts = task.attempts + 1,
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = clock_timestamp()
  FROM candidates
  WHERE task.task_id = candidates.task_id
  RETURNING task.task_id, task.task_kind, task.entity_id,
    task.entity_version, task.idempotency_key, task.lease_owner,
    task.lease_token, task.claim_generation, task.source_digest,
    task.lease_until, task.attempts, task.max_attempts;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.heartbeat_job_projection_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_lease_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid projection heartbeat duration' USING ERRCODE = '22023';
  END IF;
  UPDATE public.projection_reconciliation_tasks
  SET lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE task_id = p_task_id
    AND task_kind IN ('job.document.project', 'projection.reconcile')
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.read_job_projection_source(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_task public.projection_reconciliation_tasks%ROWTYPE;
  v_source jsonb;
BEGIN
  SELECT * INTO v_task
  FROM public.projection_reconciliation_tasks
  WHERE task_id = p_task_id
    AND task_kind = 'job.document.project'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'authoritativeVersion', v_task.entity_version::text,
    'canonicalGroupId', group_row.id::text,
    'preferredJobId', coalesce(group_row.preferred_job_id, ''),
    'groupStatus', group_row.status,
    'title', coalesce(job.title, ''),
    'normalizedTitle', job.normalized_title,
    'company', coalesce(job.company, ''),
    'location', coalesce(job.location, ''),
    'countryCode', job.country_code,
    'remote', job.remote,
    'latitude', CASE
      WHEN job.data->>'latitude' ~ '^-?[0-9]+(?:\.[0-9]+)?$'
      THEN (job.data->>'latitude')::double precision ELSE NULL END,
    'longitude', CASE
      WHEN job.data->>'longitude' ~ '^-?[0-9]+(?:\.[0-9]+)?$'
      THEN (job.data->>'longitude')::double precision ELSE NULL END,
    'publishedAt', coalesce(occurrence.published_at, job.posted_at),
    'importedAt', job.imported_at,
    'firstSeenAt', coalesce(occurrence.first_seen_at, job.first_seen_at),
    'lastSeenAt', coalesce(occurrence.last_seen_at, job.last_seen_at),
    'expiresAt', coalesce(occurrence.expires_at, job.expires_at),
    'lifecycleState', coalesce(occurrence.lifecycle_state, job.lifecycle_state),
    'validationStatus', coalesce(job.validation_status, 'unknown'),
    'applyabilityTier', coalesce(job.applyability_tier, 'E'),
    'applyFulfillmentStatus', coalesce(job.apply_fulfillment_status, 'validation_unknown'),
    'autoApplySupported', coalesce(job.auto_apply_supported, false),
    'manualFulfillmentReady', coalesce(job.manual_fulfillment_ready, false),
    'sourceEligible', coalesce(source.enabled, false),
    'policyEligible', occurrence.policy_id IS NOT NULL,
    'data', coalesce(job.data, '{}'::jsonb)
  ) INTO v_source
  FROM public.canonical_job_groups AS group_row
  LEFT JOIN public.jobs AS job ON job.job_id = group_row.preferred_job_id
  LEFT JOIN public.job_occurrences AS occurrence ON occurrence.job_id = job.job_id
  LEFT JOIN public.career_sources AS source ON source.id = occurrence.source_id
  WHERE group_row.id::text = v_task.entity_id;
  RETURN v_source;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.finish_job_projection_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL,
  p_duration_ms integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_task public.projection_reconciliation_tasks%ROWTYPE;
  v_status text;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'retryable', 'failed') OR p_duration_ms < 0 THEN
    RAISE EXCEPTION 'invalid projection finish outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task
  FROM public.projection_reconciliation_tasks
  WHERE task_id = p_task_id
    AND task_kind IN ('job.document.project', 'projection.reconcile')
    AND status = 'running'
    AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation
    AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_status := CASE
    WHEN p_outcome = 'retryable' AND v_task.attempts >= v_task.max_attempts THEN 'failed'
    ELSE p_outcome
  END;
  UPDATE public.projection_reconciliation_tasks
  SET status = v_status,
      available_at = CASE
        WHEN v_status = 'retryable' THEN coalesce(p_retry_at, clock_timestamp())
        ELSE available_at END,
      lease_owner = NULL, lease_token = NULL, lease_until = NULL,
      last_error_code = CASE WHEN v_status = 'succeeded' THEN NULL
        WHEN v_status = 'failed' AND p_outcome = 'retryable' THEN 'retry_exhausted'
        ELSE p_error_code END,
      last_error_message = CASE WHEN v_status = 'succeeded' THEN NULL ELSE left(p_error_message, 1000) END,
      updated_at = clock_timestamp()
  WHERE task_id = v_task.task_id;

  INSERT INTO public.job_projection_task_audit (
    task_id, claim_generation, task_kind, entity_id, entity_version,
    attempt, outcome, duration_ms, error_code
  ) VALUES (
    v_task.task_id, v_task.claim_generation, v_task.task_kind,
    v_task.entity_id, v_task.entity_version, v_task.attempts,
    v_status, p_duration_ms,
    CASE WHEN v_status = 'failed' AND p_outcome = 'retryable'
      THEN 'retry_exhausted' ELSE p_error_code END
  ) ON CONFLICT (task_id, claim_generation) DO NOTHING;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.complete_job_projection_upsert(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_document jsonb,
  p_source_content_hash text,
  p_duration_ms integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_task public.projection_reconciliation_tasks%ROWTYPE;
  v_existing public.job_search_documents%ROWTYPE;
  v_outcome text := 'succeeded';
  v_live_digest text;
  v_live_preferred_job_id text;
  v_live_group_status text;
  v_source_updated_at timestamptz;
BEGIN
  IF p_source_content_hash !~ '^[0-9a-f]{64}$' OR p_duration_ms < 0 THEN
    RAISE EXCEPTION 'invalid job projection result' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task FROM public.projection_reconciliation_tasks
  WHERE task_id = p_task_id AND task_kind = 'job.document.project'
    AND status = 'running' AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_document->>'canonical_group_id' IS DISTINCT FROM v_task.entity_id
    OR (p_document->>'job_version')::bigint <> v_task.entity_version
  THEN
    RAISE EXCEPTION 'projection result does not match leased entity/version'
      USING ERRCODE = '22023';
  END IF;

  v_live_digest := worker_private.job_projection_source_digest(
    (p_document->>'canonical_group_id')::uuid
  );
  SELECT group_row.preferred_job_id, group_row.status,
    greatest(
      group_row.updated_at,
      coalesce(job.lifecycle_checked_at, '-infinity'::timestamptz),
      coalesce(job.last_seen_at, '-infinity'::timestamptz),
      coalesce(occurrence.updated_at, '-infinity'::timestamptz)
    )
  INTO v_live_preferred_job_id, v_live_group_status, v_source_updated_at
  FROM public.canonical_job_groups AS group_row
  LEFT JOIN public.jobs AS job ON job.job_id = group_row.preferred_job_id
  LEFT JOIN public.job_occurrences AS occurrence ON occurrence.job_id = job.job_id
  WHERE group_row.id = (p_document->>'canonical_group_id')::uuid;

  IF v_task.source_digest IS NULL
    OR v_task.source_digest IS DISTINCT FROM v_live_digest
    OR v_live_group_status IS DISTINCT FROM 'active'
    OR v_live_preferred_job_id IS DISTINCT FROM p_document->>'preferred_job_id'
  THEN
    UPDATE public.projection_reconciliation_tasks SET
      status = 'succeeded', lease_owner = NULL, lease_token = NULL,
      lease_until = NULL, last_error_code = NULL, last_error_message = NULL,
      updated_at = clock_timestamp()
    WHERE task_id = v_task.task_id;
    INSERT INTO public.job_projection_task_audit (
      task_id, claim_generation, task_kind, entity_id, entity_version,
      attempt, outcome, result_digest, duration_ms
    ) VALUES (
      v_task.task_id, v_task.claim_generation, v_task.task_kind,
      v_task.entity_id, v_task.entity_version, v_task.attempts,
      'stale_ignored', p_source_content_hash, p_duration_ms
    );
    PERFORM worker_private.enqueue_current_job_projection_task(
      (p_document->>'canonical_group_id')::uuid,
      v_live_digest
    );
    RETURN true;
  END IF;

  SELECT * INTO v_existing FROM public.job_search_documents
  WHERE canonical_group_id = (p_document->>'canonical_group_id')::uuid
  FOR UPDATE;
  IF FOUND AND v_existing.job_version > v_task.entity_version THEN
    v_outcome := 'stale_ignored';
  ELSIF FOUND AND v_existing.job_version = v_task.entity_version
    AND v_existing.source_content_hash IS DISTINCT FROM p_source_content_hash
  THEN
    RAISE EXCEPTION 'projection version content conflict' USING ERRCODE = '40001';
  ELSE
    INSERT INTO public.job_search_documents (
      schema_version, canonical_group_id, preferred_job_id, job_version,
      lifecycle_status, normalized_title, role_family_codes, rome_codes,
      skill_codes, seniority_min, seniority_max, contract_families,
      work_modes, country_codes, latitude, longitude, location_confidence,
      location_unknown, salary_min, salary_max, currency, posted_at,
      last_seen_at, expires_at, validation_status, applyability_tier,
      fulfillment_route, source_eligible, policy_eligible,
      feature_schema_version, search_text, projected_at, source_updated_at,
      source_content_hash, source_snapshot_digest
    ) VALUES (
      p_document->>'schema_version', (p_document->>'canonical_group_id')::uuid,
      p_document->>'preferred_job_id', (p_document->>'job_version')::bigint,
      p_document->>'lifecycle_status', p_document->>'normalized_title',
      ARRAY(SELECT jsonb_array_elements_text(p_document->'role_family_codes')),
      ARRAY(SELECT jsonb_array_elements_text(p_document->'rome_codes')),
      ARRAY(SELECT jsonb_array_elements_text(p_document->'skill_codes')),
      (p_document->>'seniority_min')::integer, (p_document->>'seniority_max')::integer,
      ARRAY(SELECT jsonb_array_elements_text(p_document->'contract_families')),
      ARRAY(SELECT jsonb_array_elements_text(p_document->'work_modes')),
      ARRAY(SELECT jsonb_array_elements_text(p_document->'country_codes')),
      (p_document->>'latitude')::double precision,
      (p_document->>'longitude')::double precision,
      (p_document->>'location_confidence')::double precision,
      (p_document->>'location_unknown')::boolean,
      (p_document->>'salary_min')::numeric, (p_document->>'salary_max')::numeric,
      p_document->>'currency', (p_document->>'posted_at')::timestamptz,
      (p_document->>'last_seen_at')::timestamptz,
      (p_document->>'expires_at')::timestamptz,
      p_document->>'validation_status', p_document->>'applyability_tier',
      p_document->>'fulfillment_route', (p_document->>'source_eligible')::boolean,
      (p_document->>'policy_eligible')::boolean,
      p_document->>'feature_schema_version', p_document->>'search_text',
      (p_document->>'source_updated_at')::timestamptz,
      v_source_updated_at,
      p_source_content_hash, v_task.source_digest
    )
    ON CONFLICT (canonical_group_id) DO UPDATE SET
      preferred_job_id = EXCLUDED.preferred_job_id,
      job_version = EXCLUDED.job_version,
      lifecycle_status = EXCLUDED.lifecycle_status,
      normalized_title = EXCLUDED.normalized_title,
      role_family_codes = EXCLUDED.role_family_codes,
      rome_codes = EXCLUDED.rome_codes,
      skill_codes = EXCLUDED.skill_codes,
      seniority_min = EXCLUDED.seniority_min,
      seniority_max = EXCLUDED.seniority_max,
      contract_families = EXCLUDED.contract_families,
      work_modes = EXCLUDED.work_modes,
      country_codes = EXCLUDED.country_codes,
      latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
      location_confidence = EXCLUDED.location_confidence,
      location_unknown = EXCLUDED.location_unknown,
      salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max,
      currency = EXCLUDED.currency, posted_at = EXCLUDED.posted_at,
      last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at,
      validation_status = EXCLUDED.validation_status,
      applyability_tier = EXCLUDED.applyability_tier,
      fulfillment_route = EXCLUDED.fulfillment_route,
      source_eligible = EXCLUDED.source_eligible,
      policy_eligible = EXCLUDED.policy_eligible,
      feature_schema_version = EXCLUDED.feature_schema_version,
      search_text = EXCLUDED.search_text, projected_at = EXCLUDED.projected_at,
      source_updated_at = EXCLUDED.source_updated_at,
      source_content_hash = EXCLUDED.source_content_hash,
      source_snapshot_digest = EXCLUDED.source_snapshot_digest,
      updated_at = clock_timestamp()
    WHERE job_search_documents.job_version <= EXCLUDED.job_version;
  END IF;

  UPDATE public.projection_reconciliation_tasks SET
    status = 'succeeded', lease_owner = NULL, lease_token = NULL,
    lease_until = NULL, last_error_code = NULL, last_error_message = NULL,
    updated_at = clock_timestamp()
  WHERE task_id = v_task.task_id;
  INSERT INTO public.job_projection_task_audit (
    task_id, claim_generation, task_kind, entity_id, entity_version,
    attempt, outcome, result_digest, duration_ms
  ) VALUES (
    v_task.task_id, v_task.claim_generation, v_task.task_kind,
    v_task.entity_id, v_task.entity_version, v_task.attempts,
    v_outcome, p_source_content_hash, p_duration_ms
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.complete_job_projection_remove(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_canonical_group_id uuid,
  p_authoritative_version bigint,
  p_duration_ms integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_task public.projection_reconciliation_tasks%ROWTYPE;
  v_removed integer;
  v_live_digest text;
  v_live_group_status text;
BEGIN
  SELECT * INTO v_task FROM public.projection_reconciliation_tasks
  WHERE task_id = p_task_id AND task_kind = 'job.document.project'
    AND status = 'running' AND lease_token = p_lease_token
    AND claim_generation = p_claim_generation AND lease_owner = p_lease_owner
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_canonical_group_id::text IS DISTINCT FROM v_task.entity_id
    OR p_authoritative_version <> v_task.entity_version
  THEN
    RAISE EXCEPTION 'projection removal does not match leased entity/version'
      USING ERRCODE = '22023';
  END IF;
  v_live_digest := worker_private.job_projection_source_digest(
    p_canonical_group_id
  );
  SELECT status INTO v_live_group_status
  FROM public.canonical_job_groups
  WHERE id = p_canonical_group_id;
  IF v_task.source_digest IS NULL
    OR v_task.source_digest IS DISTINCT FROM v_live_digest
    OR v_live_group_status IS NOT DISTINCT FROM 'active'
  THEN
    UPDATE public.projection_reconciliation_tasks SET
      status = 'succeeded', lease_owner = NULL, lease_token = NULL,
      lease_until = NULL, last_error_code = NULL, last_error_message = NULL,
      updated_at = clock_timestamp()
    WHERE task_id = v_task.task_id;
    INSERT INTO public.job_projection_task_audit (
      task_id, claim_generation, task_kind, entity_id, entity_version,
      attempt, outcome, duration_ms
    ) VALUES (
      v_task.task_id, v_task.claim_generation, v_task.task_kind,
      v_task.entity_id, v_task.entity_version, v_task.attempts,
      'stale_ignored', p_duration_ms
    );
    PERFORM worker_private.enqueue_current_job_projection_task(
      p_canonical_group_id, v_live_digest
    );
    RETURN true;
  END IF;
  DELETE FROM public.job_search_documents
  WHERE canonical_group_id = p_canonical_group_id
    AND job_version <= p_authoritative_version;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  UPDATE public.projection_reconciliation_tasks SET
    status = 'succeeded', lease_owner = NULL, lease_token = NULL,
    lease_until = NULL, last_error_code = NULL, last_error_message = NULL,
    updated_at = clock_timestamp()
  WHERE task_id = v_task.task_id;
  INSERT INTO public.job_projection_task_audit (
    task_id, claim_generation, task_kind, entity_id, entity_version,
    attempt, outcome, duration_ms
  ) VALUES (
    v_task.task_id, v_task.claim_generation, v_task.task_kind,
    v_task.entity_id, v_task.entity_version, v_task.attempts,
    CASE WHEN v_removed = 1 THEN 'removed' ELSE 'stale_ignored' END,
    p_duration_ms
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.enqueue_job_projection_reconciliation(
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid job projection reconciliation limit' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matching_runtime_controls
    WHERE capability = 'projection_reconciliation' AND enabled
  ) THEN RETURN 0; END IF;

  WITH universe AS (
    SELECT id AS canonical_group_id FROM public.canonical_job_groups
    UNION
    SELECT canonical_group_id FROM public.job_search_documents
  ), snapshots AS (
    SELECT universe.canonical_group_id,
      group_row.status AS group_status,
      group_row.preferred_job_id,
      document.job_version,
      document.source_snapshot_digest,
      worker_private.job_projection_source_digest(
        universe.canonical_group_id
      ) AS source_digest,
      coalesce(task_version.max_version, 0) AS max_task_version
    FROM universe
    LEFT JOIN public.canonical_job_groups AS group_row
      ON group_row.id = universe.canonical_group_id
    LEFT JOIN public.job_search_documents AS document
      ON document.canonical_group_id = universe.canonical_group_id
    LEFT JOIN LATERAL (
      SELECT max(task.entity_version) AS max_version
      FROM public.projection_reconciliation_tasks AS task
      WHERE task.task_kind = 'job.document.project'
        AND task.entity_id = universe.canonical_group_id::text
    ) AS task_version ON true
  ), candidates AS (
    SELECT snapshot.canonical_group_id, snapshot.source_digest,
      greatest(
        coalesce(snapshot.job_version, 0), snapshot.max_task_version
      ) + 1 AS entity_version
    FROM snapshots AS snapshot
    WHERE ((
        snapshot.group_status = 'active'
        AND snapshot.preferred_job_id IS NOT NULL
        AND snapshot.source_snapshot_digest IS DISTINCT FROM snapshot.source_digest
      ) OR (
        (snapshot.group_status IS DISTINCT FROM 'active'
          OR snapshot.preferred_job_id IS NULL)
        AND snapshot.job_version IS NOT NULL
      ))
    AND NOT EXISTS (
      SELECT 1
      FROM public.projection_reconciliation_tasks AS pending
      WHERE pending.task_kind = 'job.document.project'
        AND pending.entity_id = snapshot.canonical_group_id::text
        AND pending.source_digest = snapshot.source_digest
        AND pending.status IN ('queued', 'running', 'retryable')
    )
    ORDER BY snapshot.canonical_group_id
    LIMIT p_limit
  )
  INSERT INTO public.projection_reconciliation_tasks (
    task_kind, entity_id, entity_version, idempotency_key, source_digest
  )
  SELECT 'job.document.project', candidate.canonical_group_id::text,
    candidate.entity_version,
    'job-source:' || candidate.canonical_group_id::text || ':'
      || candidate.entity_version::text || ':' || candidate.source_digest,
    candidate.source_digest
  FROM candidates AS candidate
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END
$$;

ALTER TABLE public.job_projection_task_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_projection_task_audit FROM PUBLIC;
-- PR1 granted broad table DML for schema bring-up. PR2 closes that bootstrap
-- path: production projection mutation is RPC-only so leases, controls, stale
-- checks, and audit writes cannot be bypassed by the projector credential.
REVOKE INSERT, UPDATE, DELETE ON public.matching_runtime_controls,
  public.job_search_documents,
  public.projection_reconciliation_tasks,
  public.job_projection_task_audit FROM hirly_matching_projector;
REVOKE ALL ON FUNCTION worker_private.job_projection_source_digest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.enqueue_current_job_projection_task(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.claim_job_projection_tasks(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.heartbeat_job_projection_task(uuid, uuid, bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.read_job_projection_source(uuid, uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.finish_job_projection_task(uuid, uuid, bigint, text, text, text, text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.complete_job_projection_upsert(uuid, uuid, bigint, text, jsonb, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.complete_job_projection_remove(uuid, uuid, bigint, text, uuid, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.enqueue_job_projection_reconciliation(integer) FROM PUBLIC;

GRANT SELECT ON public.job_projection_task_audit TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.claim_job_projection_tasks(text, integer, integer) TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.heartbeat_job_projection_task(uuid, uuid, bigint, text, integer) TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.read_job_projection_source(uuid, uuid, bigint, text) TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.finish_job_projection_task(uuid, uuid, bigint, text, text, text, text, timestamptz, integer) TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.complete_job_projection_upsert(uuid, uuid, bigint, text, jsonb, text, integer) TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.complete_job_projection_remove(uuid, uuid, bigint, text, uuid, bigint, integer) TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION worker_private.enqueue_job_projection_reconciliation(integer) TO hirly_matching_projector;

COMMIT;
