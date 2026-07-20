-- TS_NEW: bounded, non-canonical source-trial evidence foundation.
-- Trial writers can append only immutable trial evidence through narrow RPCs.
-- This migration does not enable a provider/source, schedule work, claim writer
-- ownership, or grant any path to canonical jobs or fulfillment state.
BEGIN;

-- Trial authorization is deliberately distinct from production eligibility.
-- Existing installations may already have the G01000 constraint, so widen it
-- here without mutating or reclassifying any existing evidence row.
ALTER TABLE public.source_policy_evidence
  DROP CONSTRAINT IF EXISTS source_policy_evidence_qualification_status_check;
ALTER TABLE public.source_policy_evidence
  ADD CONSTRAINT source_policy_evidence_qualification_status_check CHECK (
    qualification_status IN (
      'requires_legal_review',
      'dataset_specific_evidence_required',
      'trial_approved',
      'approved',
      'blocked'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'hirly_source_trial_worker'
  ) THEN
    CREATE ROLE hirly_source_trial_worker
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.source_trial_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  provider text NOT NULL,
  tenant_key text NOT NULL CHECK (length(btrim(tenant_key)) > 0),
  policy_evidence_id uuid NOT NULL
    REFERENCES public.source_policy_evidence(id) ON DELETE RESTRICT,
  permitted_access_method text NOT NULL CHECK (
    permitted_access_method IN (
      'public_api', 'open_data', 'tenant_feed', 'partner_feed'
    )
  ),
  environment text NOT NULL
    CHECK (environment IN ('development', 'test', 'staging')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  max_total_runs integer NOT NULL CHECK (max_total_runs BETWEEN 1 AND 1000),
  max_pages_per_run integer NOT NULL
    CHECK (max_pages_per_run BETWEEN 1 AND 10000),
  max_candidates_per_run integer NOT NULL
    CHECK (max_candidates_per_run BETWEEN 1 AND 1000000),
  max_bytes_per_run bigint NOT NULL
    CHECK (max_bytes_per_run BETWEEN 1 AND 1073741824),
  trial_enabled boolean NOT NULL DEFAULT false,
  approved_by text,
  approval_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_trial_policies_source_provider_fk
    FOREIGN KEY (source_id, provider)
    REFERENCES public.career_sources(id, provider)
    ON DELETE RESTRICT,
  CONSTRAINT source_trial_policies_identity_unique
    UNIQUE (source_id, environment),
  CONSTRAINT source_trial_policies_window_guard CHECK (expires_at > starts_at),
  CONSTRAINT source_trial_policies_enablement_guard CHECK (
    NOT trial_enabled
    OR (
      approved_by IS NOT NULL
      AND length(btrim(approved_by)) > 0
      AND approval_reference IS NOT NULL
      AND length(btrim(approval_reference)) > 0
    )
  )
);

CREATE OR REPLACE FUNCTION worker_private.source_policy_evidence_allows_trial(
  p_evidence_id uuid,
  p_source_key text,
  p_provider text,
  p_tenant_key text,
  p_access_method text,
  p_environment text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.source_policy_evidence AS evidence
    WHERE evidence.id = p_evidence_id
      AND evidence.source_key = p_source_key
      AND evidence.qualification_status = 'trial_approved'
      AND evidence.evidence_type IN ('licence_text', 'written_permission')
      AND evidence.claim_scope @> jsonb_build_object(
        'trialEligible', true,
        'provider', p_provider,
        'sourceKey', p_source_key,
        'tenantKey', p_tenant_key,
        'permittedAccessMethod', p_access_method,
        'rights', jsonb_build_array(
          'commercial_use',
          'redisplay',
          'retention',
          'access_method'
        )
      )
      AND evidence.claim_scope->'environments' ? p_environment
  )
$$;

CREATE OR REPLACE FUNCTION worker_private.enforce_source_trial_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.trial_enabled AND NOT EXISTS (
    SELECT 1
    FROM public.career_sources AS source
    JOIN public.source_policy_evidence AS evidence
      ON evidence.id = NEW.policy_evidence_id
    WHERE source.id = NEW.source_id
      AND source.provider = NEW.provider
      AND source.tenant_key = NEW.tenant_key
      AND source.access_type = NEW.permitted_access_method
      AND source.discovery_state IN ('validated', 'approved')
      AND NOT source.enabled
      AND NOT source.transport_enabled
      AND NOT source.incremental_enabled
      AND NOT source.backfill_enabled
      AND worker_private.source_policy_evidence_allows_trial(
        evidence.id,
        source.source_key,
        NEW.provider,
        NEW.tenant_key,
        NEW.permitted_access_method,
        NEW.environment
      )
      AND NEW.starts_at <= clock_timestamp()
      AND NEW.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION
      'source trial policy requires exact tenant/access, non-blocked evidence, disabled source, and current approval'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_trial_policy_guard
  ON public.source_trial_policies;
CREATE TRIGGER source_trial_policy_guard
BEFORE INSERT OR UPDATE ON public.source_trial_policies
FOR EACH ROW
EXECUTE FUNCTION worker_private.enforce_source_trial_policy();

CREATE TABLE IF NOT EXISTS public.source_trial_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_key text NOT NULL CHECK (length(btrim(trial_key)) > 0),
  policy_id uuid NOT NULL
    REFERENCES public.source_trial_policies(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  provider text NOT NULL,
  tenant_key text NOT NULL CHECK (length(btrim(tenant_key)) > 0),
  environment text NOT NULL
    CHECK (environment IN ('development', 'test', 'staging')),
  country_codes text[] NOT NULL CHECK (
    cardinality(country_codes) > 0
    AND worker_private.country_code_array_is_valid(country_codes)
  ),
  policy_evidence_id uuid NOT NULL
    REFERENCES public.source_policy_evidence(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  max_pages integer NOT NULL CHECK (max_pages BETWEEN 1 AND 10000),
  max_candidates integer NOT NULL
    CHECK (max_candidates BETWEEN 1 AND 1000000),
  max_bytes bigint NOT NULL CHECK (max_bytes BETWEEN 1 AND 1073741824),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_trial_runs_trial_key_unique UNIQUE (trial_key),
  CONSTRAINT source_trial_runs_identity_unique
    UNIQUE (id, policy_id, source_id, provider),
  CONSTRAINT source_trial_runs_source_provider_fk
    FOREIGN KEY (source_id, provider)
    REFERENCES public.career_sources(id, provider)
    ON DELETE RESTRICT,
  CONSTRAINT source_trial_runs_window_guard CHECK (expires_at > requested_at)
);

CREATE INDEX IF NOT EXISTS source_trial_runs_source_created_idx
  ON public.source_trial_runs (source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.source_trial_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.source_trial_runs(id) ON DELETE RESTRICT,
  page_number integer NOT NULL CHECK (page_number > 0),
  fetched_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_count bigint NOT NULL CHECK (byte_count > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) IN ('object', 'array')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_trial_pages_run_page_unique UNIQUE (run_id, page_number),
  CONSTRAINT source_trial_pages_identity_unique UNIQUE (id, run_id)
);

CREATE TABLE IF NOT EXISTS public.source_trial_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.source_trial_runs(id) ON DELETE RESTRICT,
  page_id uuid NOT NULL,
  candidate_key text NOT NULL CHECK (length(btrim(candidate_key)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  candidate jsonb NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_trial_candidates_page_fk
    FOREIGN KEY (page_id, run_id)
    REFERENCES public.source_trial_pages(id, run_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_trial_candidates_run_key_hash_unique
    UNIQUE (run_id, candidate_key, content_hash)
);

CREATE INDEX IF NOT EXISTS source_trial_candidates_run_idx
  ON public.source_trial_candidates (run_id, created_at);

CREATE TABLE IF NOT EXISTS public.source_trial_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.source_trial_runs(id) ON DELETE RESTRICT,
  scorecard_key text NOT NULL CHECK (length(btrim(scorecard_key)) > 0),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_trial_scorecards_run_unique UNIQUE (run_id),
  CONSTRAINT source_trial_scorecards_terminal_key
    CHECK (scorecard_key = 'trial-result')
);

CREATE OR REPLACE FUNCTION worker_private.reject_immutable_source_trial_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'source trial evidence is immutable' USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS source_trial_runs_immutable
  ON public.source_trial_runs;
CREATE TRIGGER source_trial_runs_immutable
BEFORE UPDATE OR DELETE ON public.source_trial_runs
FOR EACH ROW
EXECUTE FUNCTION worker_private.reject_immutable_source_trial_evidence();

DROP TRIGGER IF EXISTS source_trial_pages_immutable
  ON public.source_trial_pages;
CREATE TRIGGER source_trial_pages_immutable
BEFORE UPDATE OR DELETE ON public.source_trial_pages
FOR EACH ROW
EXECUTE FUNCTION worker_private.reject_immutable_source_trial_evidence();

DROP TRIGGER IF EXISTS source_trial_candidates_immutable
  ON public.source_trial_candidates;
CREATE TRIGGER source_trial_candidates_immutable
BEFORE UPDATE OR DELETE ON public.source_trial_candidates
FOR EACH ROW
EXECUTE FUNCTION worker_private.reject_immutable_source_trial_evidence();

DROP TRIGGER IF EXISTS source_trial_scorecards_immutable
  ON public.source_trial_scorecards;
CREATE TRIGGER source_trial_scorecards_immutable
BEFORE UPDATE OR DELETE ON public.source_trial_scorecards
FOR EACH ROW
EXECUTE FUNCTION worker_private.reject_immutable_source_trial_evidence();

CREATE OR REPLACE FUNCTION worker_private.source_trial_run_is_writable(
  p_run_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.source_trial_runs AS run
    JOIN public.source_trial_policies AS policy
      ON policy.id = run.policy_id
     AND policy.source_id = run.source_id
     AND policy.provider = run.provider
    JOIN public.career_sources AS source
      ON source.id = run.source_id
     AND source.provider = run.provider
    JOIN public.source_policy_evidence AS evidence
      ON evidence.id = run.policy_evidence_id
    WHERE run.id = p_run_id
      AND policy.trial_enabled
      AND policy.policy_evidence_id = run.policy_evidence_id
      AND policy.tenant_key = run.tenant_key
      AND policy.permitted_access_method = source.access_type
      AND policy.environment = run.environment
      AND policy.starts_at <= clock_timestamp()
      AND policy.expires_at > clock_timestamp()
      AND run.expires_at > clock_timestamp()
      AND source.tenant_key = run.tenant_key
      AND source.discovery_state IN ('validated', 'approved')
      AND NOT source.enabled
      AND NOT source.transport_enabled
      AND NOT source.incremental_enabled
      AND NOT source.backfill_enabled
      AND worker_private.source_policy_evidence_allows_trial(
        evidence.id,
        source.source_key,
        run.provider,
        run.tenant_key,
        policy.permitted_access_method,
        run.environment
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_trial_scorecards AS terminal
        WHERE terminal.run_id = run.id
      )
  )
$$;

CREATE OR REPLACE FUNCTION worker_private.source_trial_terminal_is_eligible(
  p_run_id uuid,
  p_status text,
  p_finished_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.source_trial_runs AS run
    JOIN public.source_trial_policies AS policy
      ON policy.id = run.policy_id
     AND policy.source_id = run.source_id
     AND policy.provider = run.provider
    JOIN public.career_sources AS source
      ON source.id = run.source_id
     AND source.provider = run.provider
    JOIN public.source_policy_evidence AS evidence
      ON evidence.id = run.policy_evidence_id
    WHERE run.id = p_run_id
      AND p_finished_at IS NOT NULL
      AND policy.trial_enabled
      AND policy.policy_evidence_id = run.policy_evidence_id
      AND policy.tenant_key = run.tenant_key
      AND policy.permitted_access_method = source.access_type
      AND policy.environment = run.environment
      AND policy.starts_at <= run.requested_at
      AND run.expires_at <= policy.expires_at
      AND source.tenant_key = run.tenant_key
      AND source.discovery_state IN ('validated', 'approved')
      AND NOT source.enabled
      AND NOT source.transport_enabled
      AND NOT source.incremental_enabled
      AND NOT source.backfill_enabled
      AND worker_private.source_policy_evidence_allows_trial(
        evidence.id,
        source.source_key,
        run.provider,
        run.tenant_key,
        policy.permitted_access_method,
        run.environment
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_trial_scorecards AS terminal
        WHERE terminal.run_id = run.id
      )
      AND (
        (
          p_status = 'policy_expired'
          AND clock_timestamp() >= run.expires_at
          AND clock_timestamp() <= run.expires_at + interval '5 minutes'
          AND p_finished_at >= run.expires_at
          AND p_finished_at <= clock_timestamp() + interval '5 minutes'
        )
        OR (
          p_status IN ('completed', 'budget_exhausted', 'failed')
          AND clock_timestamp() < run.expires_at
          AND clock_timestamp() < policy.expires_at
          AND p_finished_at < run.expires_at
          AND p_finished_at <= clock_timestamp() + interval '5 minutes'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION worker_private.begin_source_trial(
  p_manifest jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_policy public.source_trial_policies;
  v_source public.career_sources;
  v_run_id uuid;
  v_source_id uuid;
  v_evidence_id uuid;
  v_requested_at timestamptz;
  v_expires_at timestamptz;
  v_max_pages integer;
  v_max_candidates integer;
  v_max_bytes bigint;
  v_country_codes text[];
BEGIN
  IF p_manifest IS NULL
    OR jsonb_typeof(p_manifest) <> 'object'
    OR p_manifest->>'schemaVersion' <> 'hirly.source-trial-manifest.v1'
    OR p_manifest->>'trialKey' IS NULL
    OR length(btrim(p_manifest->>'trialKey')) = 0
    OR length(p_manifest->>'trialKey') > 256
    OR p_manifest->>'trialKey' !~ '^[a-z0-9]+(?:[a-z0-9._:-]*[a-z0-9])?$'
    OR p_manifest->>'environment' NOT IN ('development', 'test', 'staging')
    OR jsonb_typeof(p_manifest->'budget') <> 'object'
    OR jsonb_typeof(p_manifest->'countryCodes') <> 'array'
  THEN
    RAISE EXCEPTION 'invalid source trial manifest' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_source_id := (p_manifest->>'sourceId')::uuid;
    v_evidence_id := (p_manifest->>'policyEvidenceId')::uuid;
    v_requested_at := (p_manifest->>'requestedAt')::timestamptz;
    v_expires_at := (p_manifest->>'expiresAt')::timestamptz;
    v_max_pages := (p_manifest#>>'{budget,maxPages}')::integer;
    v_max_candidates := (p_manifest#>>'{budget,maxCandidates}')::integer;
    v_max_bytes := (p_manifest#>>'{budget,maxBytes}')::bigint;
    SELECT array_agg(value ORDER BY value)
    INTO v_country_codes
    FROM jsonb_array_elements_text(p_manifest->'countryCodes') AS value;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid source trial manifest' USING ERRCODE = '22023';
  END;

  SELECT source.*
  INTO v_source
  FROM public.career_sources AS source
  WHERE source.id = v_source_id
    AND source.provider = p_manifest->>'provider'
    AND source.tenant_key = p_manifest->>'tenantKey';

  SELECT policy.*
  INTO v_policy
  FROM public.source_trial_policies AS policy
  WHERE policy.source_id = v_source_id
    AND policy.provider = p_manifest->>'provider'
    AND policy.tenant_key = p_manifest->>'tenantKey'
    AND policy.environment = p_manifest->>'environment'
  FOR UPDATE;

  IF v_source.id IS NULL
    OR v_policy.id IS NULL
    OR NOT v_policy.trial_enabled
    OR v_policy.policy_evidence_id <> v_evidence_id
    OR v_policy.permitted_access_method <> v_source.access_type
    OR v_policy.starts_at > clock_timestamp()
    OR v_policy.expires_at <= clock_timestamp()
    OR v_requested_at < clock_timestamp() - interval '5 minutes'
    OR v_requested_at > clock_timestamp() + interval '5 minutes'
    OR v_expires_at <= clock_timestamp()
    OR v_expires_at > v_policy.expires_at
    OR v_max_pages < 1 OR v_max_pages > v_policy.max_pages_per_run
    OR v_max_candidates < 1
    OR v_max_candidates > v_policy.max_candidates_per_run
    OR v_max_bytes < 1 OR v_max_bytes > v_policy.max_bytes_per_run
    OR v_country_codes IS NULL
    OR NOT worker_private.country_code_array_is_valid(v_country_codes)
    OR NOT v_country_codes <@ v_source.country_codes
    OR v_source.discovery_state NOT IN ('validated', 'approved')
    OR v_source.enabled
    OR v_source.transport_enabled
    OR v_source.incremental_enabled
    OR v_source.backfill_enabled
    OR NOT EXISTS (
      SELECT 1
      FROM public.source_policy_evidence AS evidence
      WHERE evidence.id = v_evidence_id
        AND worker_private.source_policy_evidence_allows_trial(
          evidence.id,
          v_source.source_key,
          v_policy.provider,
          v_policy.tenant_key,
          v_policy.permitted_access_method,
          v_policy.environment
        )
    )
    OR (
      SELECT count(*)
      FROM public.source_trial_runs AS existing
      WHERE existing.policy_id = v_policy.id
    ) >= v_policy.max_total_runs
  THEN
    RAISE EXCEPTION
      'source trial policy, tenant, expiry, or budget gate rejected manifest'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.source_trial_runs (
    trial_key,
    policy_id,
    source_id,
    provider,
    tenant_key,
    environment,
    country_codes,
    policy_evidence_id,
    requested_at,
    expires_at,
    max_pages,
    max_candidates,
    max_bytes,
    manifest
  )
  VALUES (
    btrim(p_manifest->>'trialKey'),
    v_policy.id,
    v_source.id,
    v_source.provider,
    v_source.tenant_key,
    v_policy.environment,
    v_country_codes,
    v_evidence_id,
    v_requested_at,
    v_expires_at,
    v_max_pages,
    v_max_candidates,
    v_max_bytes,
    p_manifest
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.record_source_trial_page(
  p_run_id uuid,
  p_page_number integer,
  p_fetched_at timestamptz,
  p_serialized_payload text,
  p_content_hash text,
  p_byte_count bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_run public.source_trial_runs;
  v_page_id uuid;
  v_payload jsonb;
  v_bytes bigint;
  v_content_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));
  SELECT * INTO v_run
  FROM public.source_trial_runs
  WHERE id = p_run_id;

  BEGIN
    v_payload := p_serialized_payload::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'source trial page payload is not valid JSON'
      USING ERRCODE = '22023';
  END;
  v_bytes := octet_length(convert_to(p_serialized_payload, 'UTF8'));
  v_content_hash := encode(
    digest(convert_to(p_serialized_payload, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_run.id IS NULL
    OR NOT worker_private.source_trial_run_is_writable(p_run_id)
    OR p_page_number IS NULL OR p_page_number < 1
    OR p_page_number > v_run.max_pages
    OR p_fetched_at IS NULL OR p_fetched_at > clock_timestamp() + interval '5 minutes'
    OR p_serialized_payload IS NULL
    OR v_payload IS NULL OR jsonb_typeof(v_payload) NOT IN ('object', 'array')
    OR v_bytes < 1
    OR p_content_hash IS NULL OR p_content_hash <> v_content_hash
    OR p_byte_count IS NULL OR p_byte_count <> v_bytes
    OR v_bytes + coalesce((
      SELECT sum(page.byte_count)
      FROM public.source_trial_pages AS page
      WHERE page.run_id = p_run_id
    ), 0) > v_run.max_bytes
  THEN
    RAISE EXCEPTION 'source trial page gate rejected evidence'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.source_trial_pages (
    run_id, page_number, fetched_at, content_hash, byte_count, payload
  )
  VALUES (
    p_run_id,
    p_page_number,
    p_fetched_at,
    v_content_hash,
    v_bytes,
    v_payload
  )
  RETURNING id INTO v_page_id;

  RETURN v_page_id;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.record_source_trial_candidate(
  p_run_id uuid,
  p_page_id uuid,
  p_candidate_key text,
  p_serialized_candidate text,
  p_content_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_run public.source_trial_runs;
  v_candidate_id uuid;
  v_candidate jsonb;
  v_content_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));
  SELECT * INTO v_run
  FROM public.source_trial_runs
  WHERE id = p_run_id;

  BEGIN
    v_candidate := p_serialized_candidate::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'source trial candidate is not valid JSON'
      USING ERRCODE = '22023';
  END;
  v_content_hash := encode(
    digest(convert_to(p_serialized_candidate, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_run.id IS NULL
    OR NOT worker_private.source_trial_run_is_writable(p_run_id)
    OR p_candidate_key IS NULL OR length(btrim(p_candidate_key)) = 0
    OR length(p_candidate_key) > 512
    OR p_serialized_candidate IS NULL
    OR v_candidate IS NULL OR jsonb_typeof(v_candidate) <> 'object'
    OR p_content_hash IS NULL OR p_content_hash <> v_content_hash
    OR NOT EXISTS (
      SELECT 1 FROM public.source_trial_pages
      WHERE id = p_page_id AND run_id = p_run_id
    )
    OR (
      SELECT count(*)
      FROM public.source_trial_candidates
      WHERE run_id = p_run_id
    ) >= v_run.max_candidates
  THEN
    RAISE EXCEPTION 'source trial candidate gate rejected evidence'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.source_trial_candidates (
    run_id, page_id, candidate_key, content_hash, candidate
  )
  VALUES (
    p_run_id,
    p_page_id,
    btrim(p_candidate_key),
    v_content_hash,
    v_candidate
  )
  RETURNING id INTO v_candidate_id;

  RETURN v_candidate_id;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.record_source_trial_scorecard(
  p_run_id uuid,
  p_scorecard_key text,
  p_result jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_run public.source_trial_runs;
  v_scorecard_id uuid;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_pages_fetched bigint;
  v_candidates_observed bigint;
  v_bytes_stored bigint;
  v_persisted_pages bigint;
  v_persisted_candidates bigint;
  v_persisted_bytes bigint;
  v_status text;
  v_stop_reason text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));
  SELECT * INTO v_run
  FROM public.source_trial_runs
  WHERE id = p_run_id;

  IF v_run.id IS NULL
    OR p_scorecard_key IS DISTINCT FROM 'trial-result'
    OR p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
  THEN
    RAISE EXCEPTION 'source trial scorecard gate rejected evidence'
      USING ERRCODE = '42501';
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(p_result)) <> 10
    OR NOT (p_result ?& ARRAY[
      'schemaVersion', 'runId', 'trialKey', 'status', 'startedAt',
      'finishedAt', 'pagesFetched', 'candidatesObserved', 'bytesStored',
      'stopReason'
    ])
    OR p_result->>'schemaVersion'
      IS DISTINCT FROM 'hirly.source-trial-result.v1'
    OR p_result->>'runId' IS DISTINCT FROM p_run_id::text
    OR p_result->>'trialKey' IS DISTINCT FROM v_run.trial_key
    OR p_result->>'status' IS NULL
    OR p_result->>'status' NOT IN (
      'completed', 'budget_exhausted', 'policy_expired', 'failed'
    )
    OR jsonb_typeof(p_result->'startedAt') <> 'string'
    OR jsonb_typeof(p_result->'finishedAt') <> 'string'
    OR jsonb_typeof(p_result->'pagesFetched') <> 'number'
    OR jsonb_typeof(p_result->'candidatesObserved') <> 'number'
    OR jsonb_typeof(p_result->'bytesStored') <> 'number'
    OR p_result->>'pagesFetched' !~ '^(0|[1-9][0-9]*)$'
    OR p_result->>'candidatesObserved' !~ '^(0|[1-9][0-9]*)$'
    OR p_result->>'bytesStored' !~ '^(0|[1-9][0-9]*)$'
    OR jsonb_typeof(p_result->'stopReason') NOT IN ('string', 'null')
  THEN
    RAISE EXCEPTION 'source trial scorecard gate rejected evidence'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_started_at := (p_result->>'startedAt')::timestamptz;
    v_finished_at := (p_result->>'finishedAt')::timestamptz;
    v_pages_fetched := (p_result->>'pagesFetched')::bigint;
    v_candidates_observed := (p_result->>'candidatesObserved')::bigint;
    v_bytes_stored := (p_result->>'bytesStored')::bigint;
  EXCEPTION
    WHEN invalid_text_representation
      OR numeric_value_out_of_range
      OR datetime_field_overflow
  THEN
    RAISE EXCEPTION 'source trial scorecard contains invalid typed values'
      USING ERRCODE = '22023';
  END;

  v_status := p_result->>'status';
  v_stop_reason := p_result->>'stopReason';
  SELECT
    count(*),
    coalesce(sum(page.byte_count), 0)
  INTO v_persisted_pages, v_persisted_bytes
  FROM public.source_trial_pages AS page
  WHERE page.run_id = p_run_id;
  SELECT count(*)
  INTO v_persisted_candidates
  FROM public.source_trial_candidates AS candidate
  WHERE candidate.run_id = p_run_id;

  IF v_started_at <> v_run.requested_at
    OR NOT worker_private.source_trial_terminal_is_eligible(
      p_run_id,
      v_status,
      v_finished_at
    )
    OR v_finished_at < v_started_at
    OR v_finished_at > clock_timestamp() + interval '5 minutes'
    OR v_pages_fetched < 0
    OR v_candidates_observed < 0
    OR v_bytes_stored < 0
    OR v_pages_fetched <> v_persisted_pages
    OR v_candidates_observed <> v_persisted_candidates
    OR v_bytes_stored <> v_persisted_bytes
    OR (v_status = 'completed' AND v_persisted_pages = 0)
    OR (v_status = 'completed' AND v_stop_reason IS NOT NULL)
    OR (
      v_status = 'policy_expired'
      AND v_stop_reason IS DISTINCT FROM 'policy_expired'
    )
    OR (
      v_status = 'budget_exhausted'
      AND v_stop_reason NOT IN (
        'budget_exceeded',
        'budget_exceeded:maxPages',
        'budget_exceeded:maxCandidates',
        'budget_exceeded:maxBytes'
      )
    )
    OR (
      v_status = 'failed'
      AND v_stop_reason NOT IN (
        'cancelled',
        'malformed',
        'not_found',
        'permanent',
        'policy_not_started',
        'rate_limited',
        'retryable',
        'unclassified_failure'
      )
    )
    OR (
      v_status <> 'completed'
      AND (
        v_stop_reason IS NULL
        OR length(btrim(v_stop_reason)) = 0
        OR length(v_stop_reason) > 512
      )
    )
  THEN
    RAISE EXCEPTION
      'source trial terminal result does not reconcile with persisted evidence'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.source_trial_scorecards (run_id, scorecard_key, result)
  VALUES (p_run_id, 'trial-result', p_result)
  RETURNING id INTO v_scorecard_id;

  RETURN v_scorecard_id;
END
$$;

REVOKE ALL ON public.source_trial_policies, public.source_trial_runs,
  public.source_trial_pages, public.source_trial_candidates,
  public.source_trial_scorecards FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hirly_source_trial_worker;
REVOKE CREATE ON SCHEMA public FROM hirly_source_trial_worker;

REVOKE ALL ON FUNCTION worker_private.source_trial_run_is_writable(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.source_trial_terminal_is_eligible(
  uuid, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.begin_source_trial(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.record_source_trial_page(
  uuid, integer, timestamptz, text, text, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.record_source_trial_candidate(
  uuid, uuid, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.record_source_trial_scorecard(
  uuid, text, jsonb
) FROM PUBLIC;

GRANT USAGE ON SCHEMA worker_private TO hirly_source_trial_worker;
GRANT EXECUTE ON FUNCTION worker_private.begin_source_trial(jsonb)
  TO hirly_source_trial_worker;
GRANT EXECUTE ON FUNCTION worker_private.record_source_trial_page(
  uuid, integer, timestamptz, text, text, bigint
) TO hirly_source_trial_worker;
GRANT EXECUTE ON FUNCTION worker_private.record_source_trial_candidate(
  uuid, uuid, text, text, text
) TO hirly_source_trial_worker;
GRANT EXECUTE ON FUNCTION worker_private.record_source_trial_scorecard(
  uuid, text, jsonb
) TO hirly_source_trial_worker;

GRANT SELECT ON public.source_trial_policies, public.source_trial_runs,
  public.source_trial_pages, public.source_trial_candidates,
  public.source_trial_scorecards TO hirly_inventory_operator;

COMMIT;
