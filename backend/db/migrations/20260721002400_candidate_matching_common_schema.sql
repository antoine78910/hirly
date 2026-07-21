-- Inventory database only: common ONLINE_FIRST projection/read-model schema.
-- This migration intentionally contains no generation, match-row, or fanout
-- storage. Every producer/serving control starts disabled.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_matching_projector') THEN
    CREATE ROLE hirly_matching_projector NOLOGIN NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirly_matching_reader') THEN
    CREATE ROLE hirly_matching_reader NOLOGIN NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE TABLE public.matching_runtime_controls (
  capability text PRIMARY KEY CHECK (
    capability IN (
      'profile_projection', 'action_projection', 'job_projection',
      'projection_reconciliation', 'online_serving'
    )
  ),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL DEFAULT current_user
);

INSERT INTO public.matching_runtime_controls (capability)
VALUES
  ('profile_projection'),
  ('action_projection'),
  ('job_projection'),
  ('projection_reconciliation'),
  ('online_serving')
ON CONFLICT (capability) DO NOTHING;

CREATE TABLE public.candidate_projection_tombstones (
  candidate_id text PRIMARY KEY CHECK (length(btrim(candidate_id)) > 0),
  deletion_version bigint NOT NULL CHECK (deletion_version > 0),
  source_event_id uuid NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  purge_verified_at timestamptz,
  restore_replay_verified_at timestamptz
);

CREATE TABLE public.candidate_search_profiles (
  schema_version text NOT NULL DEFAULT 'hirly.matching.v1'
    CHECK (schema_version = 'hirly.matching.v1'),
  candidate_id text PRIMARY KEY CHECK (length(btrim(candidate_id)) > 0),
  version bigint NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'deleted')),
  target_role_label_normalized text,
  role_family_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  rome_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  skill_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  skill_terms text[] NOT NULL DEFAULT ARRAY[]::text[],
  seniority_min integer CHECK (seniority_min IS NULL OR seniority_min BETWEEN 0 AND 20),
  seniority_max integer CHECK (seniority_max IS NULL OR seniority_max BETWEEN 0 AND 20),
  contract_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  work_modes text[] NOT NULL DEFAULT ARRAY[]::text[],
  country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  location_policy text
    CHECK (location_policy IN ('explicit', 'country', 'worldwide')),
  origin_latitude double precision,
  origin_longitude double precision,
  radius_km double precision CHECK (radius_km IS NULL OR radius_km > 0 AND radius_km <= 20000),
  salary_floor numeric CHECK (salary_floor IS NULL OR salary_floor >= 0),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  freshness_window_days integer CHECK (freshness_window_days BETWEEN 1 AND 365),
  exposure_policy_version text NOT NULL CHECK (length(btrim(exposure_policy_version)) > 0),
  feature_schema_version text NOT NULL CHECK (length(btrim(feature_schema_version)) > 0),
  source_profile_updated_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL,
  source_event_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT candidate_search_profiles_location_guard CHECK (
    (origin_latitude IS NULL AND origin_longitude IS NULL)
    OR (origin_latitude BETWEEN -90 AND 90 AND origin_longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT candidate_search_profiles_seniority_guard CHECK (
    seniority_min IS NULL OR seniority_max IS NULL OR seniority_max >= seniority_min
  ),
  CONSTRAINT candidate_search_profiles_deleted_guard CHECK (
    status <> 'deleted'
    OR (
      target_role_label_normalized IS NULL
      AND cardinality(role_family_ids) = 0
      AND cardinality(rome_codes) = 0
      AND cardinality(skill_ids) = 0
      AND cardinality(skill_terms) = 0
      AND seniority_min IS NULL
      AND seniority_max IS NULL
      AND cardinality(contract_types) = 0
      AND cardinality(work_modes) = 0
      AND origin_latitude IS NULL
      AND origin_longitude IS NULL
      AND radius_km IS NULL
      AND cardinality(country_codes) = 0
      AND location_policy IS NULL
      AND salary_floor IS NULL
      AND currency IS NULL
      AND freshness_window_days IS NULL
    )
  ),
  CONSTRAINT candidate_search_profiles_active_guard CHECK (
    status = 'deleted' OR (location_policy IS NOT NULL AND freshness_window_days IS NOT NULL)
  )
);

CREATE INDEX candidate_search_profiles_active_country_role_idx
  ON public.candidate_search_profiles
  USING gin (country_codes, role_family_ids)
  WHERE status = 'active';
CREATE INDEX candidate_search_profiles_active_updated_idx
  ON public.candidate_search_profiles (updated_at, candidate_id)
  WHERE status = 'active';

CREATE TABLE public.candidate_action_projection (
  schema_version text NOT NULL DEFAULT 'hirly.matching.v1'
    CHECK (schema_version = 'hirly.matching.v1'),
  candidate_id text NOT NULL CHECK (length(btrim(candidate_id)) > 0),
  action_id text NOT NULL CHECK (length(btrim(action_id)) > 0),
  candidate_version bigint NOT NULL CHECK (candidate_version > 0),
  source_job_id text NOT NULL CHECK (length(btrim(source_job_id)) > 0),
  canonical_group_id uuid NOT NULL,
  canonical_group_aliases uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  action_kind text NOT NULL CHECK (
    action_kind IN ('seen', 'dismissed', 'applied', 'undo')
  ),
  action_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL,
  retention_state text NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'superseded', 'deleted')),
  retained_until timestamptz,
  source_event_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (candidate_id, action_id),
  CONSTRAINT candidate_action_projection_aliases_guard CHECK (
    NOT canonical_group_id = ANY(canonical_group_aliases)
  )
);

CREATE INDEX candidate_action_projection_exclusion_idx
  ON public.candidate_action_projection (
    candidate_id, canonical_group_id, candidate_version DESC
  )
  WHERE retention_state = 'active';
CREATE INDEX candidate_action_projection_source_job_idx
  ON public.candidate_action_projection (candidate_id, source_job_id)
  WHERE retention_state = 'active';
CREATE INDEX candidate_action_projection_retention_idx
  ON public.candidate_action_projection (retained_until, candidate_id)
  WHERE retention_state <> 'active';

CREATE TABLE public.candidate_action_group_aliases (
  alias_group_id uuid NOT NULL,
  canonical_group_id uuid NOT NULL,
  alias_kind text NOT NULL CHECK (alias_kind IN ('merge', 'split')),
  alias_version bigint NOT NULL CHECK (alias_version > 0),
  source_event_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (alias_group_id, canonical_group_id),
  UNIQUE (source_event_id, alias_group_id, canonical_group_id),
  CONSTRAINT candidate_action_group_aliases_identity_guard CHECK (
    alias_group_id IS DISTINCT FROM canonical_group_id
  )
);

CREATE INDEX candidate_action_group_aliases_canonical_idx
  ON public.candidate_action_group_aliases (canonical_group_id, alias_kind, alias_version DESC);
CREATE INDEX candidate_action_group_aliases_alias_idx
  ON public.candidate_action_group_aliases (alias_group_id, alias_kind, alias_version DESC);

CREATE TABLE public.job_search_documents (
  schema_version text NOT NULL DEFAULT 'hirly.matching.v1'
    CHECK (schema_version = 'hirly.matching.v1'),
  canonical_group_id uuid PRIMARY KEY,
  preferred_job_id text NOT NULL CHECK (length(btrim(preferred_job_id)) > 0),
  job_version bigint NOT NULL CHECK (job_version > 0),
  lifecycle_status text NOT NULL
    CHECK (lifecycle_status IN ('active', 'stale', 'expired', 'removed', 'blocked')),
  normalized_title text NOT NULL CHECK (length(btrim(normalized_title)) > 0),
  role_family_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  rome_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  skill_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  seniority_min integer CHECK (seniority_min IS NULL OR seniority_min BETWEEN 0 AND 20),
  seniority_max integer CHECK (seniority_max IS NULL OR seniority_max BETWEEN 0 AND 20),
  contract_families text[] NOT NULL DEFAULT ARRAY[]::text[],
  work_modes text[] NOT NULL DEFAULT ARRAY[]::text[],
  country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  latitude double precision,
  longitude double precision,
  location_confidence double precision NOT NULL CHECK (location_confidence BETWEEN 0 AND 1),
  location_unknown boolean NOT NULL,
  salary_min numeric CHECK (salary_min IS NULL OR salary_min >= 0),
  salary_max numeric CHECK (salary_max IS NULL OR salary_max >= 0),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  posted_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz,
  validation_status text NOT NULL CHECK (validation_status IN ('valid', 'review', 'invalid')),
  applyability_tier text NOT NULL CHECK (applyability_tier IN ('A', 'B', 'C', 'D', 'blocked')),
  fulfillment_route text NOT NULL CHECK (
    fulfillment_route IN ('auto', 'assisted', 'manual', 'blocked')
  ),
  source_eligible boolean NOT NULL,
  policy_eligible boolean NOT NULL,
  feature_schema_version text NOT NULL CHECK (length(btrim(feature_schema_version)) > 0),
  search_text text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  projected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT job_search_documents_salary_guard CHECK (
    salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min
  ),
  CONSTRAINT job_search_documents_seniority_guard CHECK (
    seniority_min IS NULL OR seniority_max IS NULL OR seniority_max >= seniority_min
  ),
  CONSTRAINT job_search_documents_location_guard CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT job_search_documents_location_unknown_guard CHECK (
    NOT location_unknown OR (latitude IS NULL AND longitude IS NULL)
  )
);

CREATE INDEX job_search_documents_retrieval_idx
  ON public.job_search_documents (
    lifecycle_status, source_eligible, policy_eligible, last_seen_at DESC,
    canonical_group_id
  );
CREATE INDEX job_search_documents_features_idx
  ON public.job_search_documents
  USING gin (country_codes, role_family_codes, work_modes, contract_families)
  WHERE lifecycle_status = 'active' AND source_eligible AND policy_eligible;
CREATE INDEX job_search_documents_search_idx
  ON public.job_search_documents USING gin (search_vector)
  WHERE lifecycle_status = 'active' AND source_eligible AND policy_eligible;
CREATE INDEX job_search_documents_preferred_job_idx
  ON public.job_search_documents (preferred_job_id, job_version DESC);

CREATE TABLE public.projection_reconciliation_tasks (
  schema_version text NOT NULL DEFAULT 'hirly.matching.v1'
    CHECK (schema_version = 'hirly.matching.v1'),
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_kind text NOT NULL CHECK (
    task_kind IN (
      'candidate.profile.project', 'candidate.action.project',
      'candidate.delete', 'job.document.project', 'projection.reconcile'
    )
  ),
  entity_id text NOT NULL CHECK (length(btrim(entity_id)) > 0),
  entity_version bigint NOT NULL CHECK (entity_version > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retryable', 'succeeded', 'failed', 'cancelled')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 100),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT projection_reconciliation_tasks_lease_guard CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
  )
);

CREATE INDEX projection_reconciliation_tasks_ready_idx
  ON public.projection_reconciliation_tasks (available_at, task_id)
  WHERE status IN ('queued', 'retryable');
CREATE INDEX projection_reconciliation_tasks_entity_version_idx
  ON public.projection_reconciliation_tasks (task_kind, entity_id, entity_version DESC);

CREATE OR REPLACE FUNCTION public.candidate_projection_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.candidate_projection_tombstones
    WHERE candidate_id = NEW.candidate_id
  ) THEN
    RAISE EXCEPTION 'deleted candidate projection cannot be recreated'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'candidate_search_profiles' AND NEW.version <= OLD.version THEN
      RAISE EXCEPTION 'candidate profile version must increase'
        USING ERRCODE = '22023';
    END IF;
    IF TG_TABLE_NAME = 'candidate_action_projection'
      AND NEW.candidate_version <= OLD.candidate_version
    THEN
      RAISE EXCEPTION 'candidate action version must increase'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_search_profiles_version_guard
BEFORE INSERT OR UPDATE ON public.candidate_search_profiles
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_version_guard();
CREATE TRIGGER candidate_action_projection_version_guard
BEFORE INSERT OR UPDATE ON public.candidate_action_projection
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_version_guard();

CREATE OR REPLACE FUNCTION public.candidate_action_group_alias_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candidate action group aliases cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.alias_group_id IS DISTINCT FROM OLD.alias_group_id
    OR NEW.canonical_group_id IS DISTINCT FROM OLD.canonical_group_id
    OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
    OR NEW.alias_version < OLD.alias_version
    OR (
      NEW.alias_version = OLD.alias_version
      AND (
        NEW.alias_kind IS DISTINCT FROM OLD.alias_kind
      )
    )
  ) THEN
    RAISE EXCEPTION 'candidate action group alias must only advance monotonically'
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (
    WITH RECURSIVE descendants(group_id) AS (
      SELECT NEW.canonical_group_id
      UNION
      SELECT alias.canonical_group_id
      FROM public.candidate_action_group_aliases AS alias
      JOIN descendants
        ON alias.alias_group_id = descendants.group_id
    )
    SELECT 1
    FROM descendants
    WHERE group_id = NEW.alias_group_id
  ) THEN
    RAISE EXCEPTION 'candidate action group aliases cannot contain cycles'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_action_group_alias_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.candidate_action_group_aliases
FOR EACH ROW EXECUTE FUNCTION public.candidate_action_group_alias_guard();

CREATE OR REPLACE FUNCTION public.candidate_group_is_excluded(
  p_candidate_id text,
  p_canonical_group_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH RECURSIVE excluded_groups(group_id) AS (
    SELECT action.canonical_group_id
    FROM public.candidate_action_projection AS action
    WHERE action.candidate_id = p_candidate_id
      AND action.retention_state = 'active'
      AND action.canonical_group_id IS NOT NULL
    UNION
    SELECT alias.canonical_group_id
    FROM public.candidate_action_group_aliases AS alias
    JOIN excluded_groups
      ON alias.alias_group_id = excluded_groups.group_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM excluded_groups
    WHERE group_id = p_canonical_group_id
  )
$$;

CREATE OR REPLACE FUNCTION public.candidate_projection_tombstone_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candidate projection tombstones cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
    OR NEW.deletion_version < OLD.deletion_version
    OR (
      NEW.deletion_version = OLD.deletion_version
      AND NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
    )
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'candidate projection tombstone cannot be lowered or reassigned'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_projection_tombstone_guard
BEFORE UPDATE OR DELETE ON public.candidate_projection_tombstones
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_tombstone_guard();

CREATE OR REPLACE FUNCTION public.apply_candidate_projection_tombstone(
  p_candidate_id text,
  p_deletion_version bigint,
  p_source_event_id uuid,
  p_requested_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_applied integer;
BEGIN
  IF length(btrim(coalesce(p_candidate_id, ''))) = 0
    OR p_deletion_version <= 0
    OR p_source_event_id IS NULL
    OR p_requested_at IS NULL
  THEN
    RAISE EXCEPTION 'invalid candidate tombstone' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.candidate_projection_tombstones (
    candidate_id, deletion_version, source_event_id, requested_at
  ) VALUES (
    p_candidate_id, p_deletion_version, p_source_event_id, p_requested_at
  )
  ON CONFLICT (candidate_id) DO UPDATE SET
    deletion_version = EXCLUDED.deletion_version,
    source_event_id = EXCLUDED.source_event_id,
    requested_at = EXCLUDED.requested_at,
    applied_at = clock_timestamp(),
    purge_verified_at = NULL,
    restore_replay_verified_at = NULL
  WHERE candidate_projection_tombstones.deletion_version < EXCLUDED.deletion_version;
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  IF v_applied = 0 THEN
    RETURN false;
  END IF;
  DELETE FROM public.candidate_action_projection WHERE candidate_id = p_candidate_id;
  DELETE FROM public.candidate_search_profiles WHERE candidate_id = p_candidate_id;
  RETURN true;
END
$$;

ALTER TABLE public.matching_runtime_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_projection_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_search_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_action_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_action_group_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projection_reconciliation_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.matching_runtime_controls,
  public.candidate_projection_tombstones,
  public.candidate_search_profiles,
  public.candidate_action_projection,
  public.candidate_action_group_aliases,
  public.job_search_documents,
  public.projection_reconciliation_tasks FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_projection_version_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_action_group_alias_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_group_is_excluded(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_projection_tombstone_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_candidate_projection_tombstone(text, bigint, uuid, timestamptz)
  FROM PUBLIC;

CREATE POLICY candidate_projection_tombstones_projector
  ON public.candidate_projection_tombstones TO hirly_matching_projector
  USING (true) WITH CHECK (true);
CREATE POLICY candidate_search_profiles_projector
  ON public.candidate_search_profiles TO hirly_matching_projector
  USING (true) WITH CHECK (true);
CREATE POLICY candidate_action_projection_projector
  ON public.candidate_action_projection TO hirly_matching_projector
  USING (true) WITH CHECK (true);
CREATE POLICY candidate_action_group_aliases_projector
  ON public.candidate_action_group_aliases TO hirly_matching_projector
  USING (true) WITH CHECK (true);
CREATE POLICY job_search_documents_projector
  ON public.job_search_documents TO hirly_matching_projector
  USING (true) WITH CHECK (true);
CREATE POLICY projection_reconciliation_tasks_projector
  ON public.projection_reconciliation_tasks TO hirly_matching_projector
  USING (true) WITH CHECK (true);
CREATE POLICY candidate_projection_tombstones_reader
  ON public.candidate_projection_tombstones FOR SELECT TO hirly_matching_reader
  USING (
    candidate_id = nullif(current_setting('hirly.matching_candidate_id', true), '')
  );
CREATE POLICY candidate_search_profiles_reader
  ON public.candidate_search_profiles FOR SELECT TO hirly_matching_reader
  USING (
    candidate_id = nullif(current_setting('hirly.matching_candidate_id', true), '')
  );
CREATE POLICY candidate_action_projection_reader
  ON public.candidate_action_projection FOR SELECT TO hirly_matching_reader
  USING (
    candidate_id = nullif(current_setting('hirly.matching_candidate_id', true), '')
  );
CREATE POLICY candidate_action_group_aliases_reader
  ON public.candidate_action_group_aliases FOR SELECT TO hirly_matching_reader
  USING (true);
CREATE POLICY job_search_documents_reader
  ON public.job_search_documents FOR SELECT TO hirly_matching_reader
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_projection_tombstones,
  public.candidate_search_profiles,
  public.candidate_action_projection,
  public.candidate_action_group_aliases,
  public.job_search_documents,
  public.projection_reconciliation_tasks TO hirly_matching_projector;
GRANT SELECT ON public.candidate_projection_tombstones,
  public.candidate_search_profiles,
  public.candidate_action_projection,
  public.candidate_action_group_aliases,
  public.job_search_documents TO hirly_matching_reader;
GRANT EXECUTE ON FUNCTION public.apply_candidate_projection_tombstone(text, bigint, uuid, timestamptz)
  TO hirly_matching_projector;
GRANT EXECUTE ON FUNCTION public.candidate_group_is_excluded(text, uuid)
  TO hirly_matching_reader, hirly_matching_projector;

COMMIT;
