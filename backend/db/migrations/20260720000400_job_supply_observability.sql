-- TS_NEW: additive job-supply observability and France Travail census metadata.
-- This migration does not enable a source, mutate canonical jobs, or transfer
-- provider writer ownership. provider_registry.writer_runtime remains the sole
-- canonical-writer authority.
BEGIN;

CREATE TABLE IF NOT EXISTS public.source_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  policy_key text NOT NULL CHECK (length(btrim(policy_key)) > 0),
  licence_name text,
  licence_url text,
  commercial_use_allowed boolean NOT NULL DEFAULT false,
  redisplay_allowed boolean NOT NULL DEFAULT false,
  full_text_retention_allowed boolean NOT NULL DEFAULT false,
  attribution_template text,
  permitted_access_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_reference text,
  agreement_reference text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  reviewer text,
  enabled_environments text[] NOT NULL DEFAULT ARRAY[]::text[],
  approval_status text NOT NULL DEFAULT 'unverified'
    CHECK (approval_status IN ('unverified', 'approved', 'blocked', 'expired')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_policy_id_provider_unique UNIQUE (id, provider),
  CONSTRAINT source_policy_key_unique UNIQUE (provider, policy_key),
  CONSTRAINT source_policy_environment_guard CHECK (
    enabled_environments <@ ARRAY['development', 'test', 'staging', 'production']::text[]
  ),
  CONSTRAINT source_policy_review_window_guard CHECK (
    expires_at IS NULL OR (reviewed_at IS NOT NULL AND expires_at > reviewed_at)
  ),
  CONSTRAINT source_policy_approval_evidence_guard CHECK (
    approval_status <> 'approved'
    OR (
      evidence_reference IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND reviewer IS NOT NULL
      AND cardinality(permitted_access_methods) > 0
    )
  )
);

CREATE OR REPLACE FUNCTION worker_private.enforce_source_policy_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.enabled AND (
    NEW.approval_status <> 'approved'
    OR NOT NEW.commercial_use_allowed
    OR NOT NEW.redisplay_allowed
    OR NEW.evidence_reference IS NULL
    OR NEW.reviewed_at IS NULL
    OR NEW.reviewer IS NULL
    OR cardinality(NEW.permitted_access_methods) = 0
    OR NOT ('production' = ANY(NEW.enabled_environments))
    OR NEW.expires_at IS NULL
    OR NEW.expires_at <= clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'source policy is not current and approved for production'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_policy_activation_guard ON public.source_policy;
CREATE TRIGGER source_policy_activation_guard
BEFORE INSERT OR UPDATE ON public.source_policy
FOR EACH ROW EXECUTE FUNCTION worker_private.enforce_source_policy_activation();

ALTER TABLE public.provider_registry
  ADD COLUMN IF NOT EXISTS default_sync_frequency interval
    CHECK (default_sync_frequency IS NULL OR default_sync_frequency > interval '0 seconds'),
  ADD COLUMN IF NOT EXISTS default_rate_limit_config jsonb NOT NULL
    DEFAULT '{"requestsPerMinute":1,"concurrency":1}'::jsonb,
  ADD COLUMN IF NOT EXISTS policy_id uuid,
  ADD COLUMN IF NOT EXISTS country_kill_switches jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capability_version text NOT NULL DEFAULT 'source-observability.v1',
  ADD CONSTRAINT provider_registry_default_rate_limit_guard CHECK (
    jsonb_typeof(default_rate_limit_config) = 'object'
    AND (default_rate_limit_config->>'requestsPerMinute') ~ '^[1-9][0-9]*$'
    AND (default_rate_limit_config->>'concurrency') ~ '^[1-9][0-9]*$'
  ),
  ADD CONSTRAINT provider_registry_country_kill_switches_guard CHECK (
    jsonb_typeof(country_kill_switches) = 'object'
  ),
  ADD CONSTRAINT provider_registry_capability_version_guard CHECK (
    length(btrim(capability_version)) > 0
  ),
  ADD CONSTRAINT provider_registry_policy_provider_fk
    FOREIGN KEY (policy_id, provider)
    REFERENCES public.source_policy(id, provider)
    ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.career_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (length(btrim(source_key)) > 0),
  tenant_key text,
  company_id text,
  company_name text,
  country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  base_url text,
  access_type text NOT NULL
    CHECK (access_type IN ('public_api', 'open_data', 'tenant_feed', 'partner_feed')),
  policy_id uuid,
  sync_frequency interval CHECK (sync_frequency IS NULL OR sync_frequency > interval '0 seconds'),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_complete_run_id uuid REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  enabled boolean NOT NULL DEFAULT false,
  discovery_state text NOT NULL DEFAULT 'candidate'
    CHECK (discovery_state IN ('candidate', 'detected', 'validated', 'rejected', 'approved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT career_sources_id_provider_unique UNIQUE (id, provider),
  CONSTRAINT career_sources_provider_key_unique UNIQUE (provider, source_key),
  CONSTRAINT career_sources_tenant_key_guard CHECK (
    tenant_key IS NULL OR length(btrim(tenant_key)) > 0
  ),
  CONSTRAINT career_sources_attempt_order_guard CHECK (
    last_success_at IS NULL OR last_attempt_at IS NULL OR last_success_at <= last_attempt_at
  ),
  CONSTRAINT career_sources_policy_provider_fk
    FOREIGN KEY (policy_id, provider)
    REFERENCES public.source_policy(id, provider)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS career_sources_provider_tenant_unique
  ON public.career_sources (provider, tenant_key)
  WHERE tenant_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS career_sources_provider_discovery_idx
  ON public.career_sources (provider, discovery_state, source_key);
CREATE INDEX IF NOT EXISTS career_sources_policy_idx
  ON public.career_sources (policy_id)
  WHERE policy_id IS NOT NULL;

CREATE OR REPLACE FUNCTION worker_private.enforce_career_source_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.enabled AND NOT EXISTS (
    SELECT 1
    FROM public.provider_registry AS registry
    JOIN public.source_policy AS policy
      ON policy.id = NEW.policy_id
     AND policy.provider = registry.provider
    WHERE registry.provider = NEW.provider
      AND registry.enabled
      AND registry.authorization_status = 'authorized'
      AND registry.writer_runtime IN ('python', 'typescript')
      AND policy.enabled
      AND policy.approval_status = 'approved'
      AND policy.commercial_use_allowed
      AND policy.redisplay_allowed
      AND 'production' = ANY(policy.enabled_environments)
      AND policy.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION
      'career source activation requires an enabled provider and current approved production policy'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS career_source_activation_guard ON public.career_sources;
CREATE TRIGGER career_source_activation_guard
BEFORE INSERT OR UPDATE ON public.career_sources
FOR EACH ROW EXECUTE FUNCTION worker_private.enforce_career_source_activation();

CREATE OR REPLACE FUNCTION worker_private.disable_sources_after_policy_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT NEW.enabled
    OR NEW.approval_status <> 'approved'
    OR NOT NEW.commercial_use_allowed
    OR NOT NEW.redisplay_allowed
    OR NOT ('production' = ANY(NEW.enabled_environments))
    OR NEW.expires_at IS NULL
    OR NEW.expires_at <= clock_timestamp()
  THEN
    UPDATE public.career_sources
    SET enabled = false, updated_at = clock_timestamp()
    WHERE policy_id = NEW.id AND enabled;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_policy_disable_sources ON public.source_policy;
CREATE TRIGGER source_policy_disable_sources
AFTER UPDATE ON public.source_policy
FOR EACH ROW EXECUTE FUNCTION worker_private.disable_sources_after_policy_change();

CREATE OR REPLACE FUNCTION worker_private.disable_sources_after_provider_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT NEW.enabled
    OR NEW.authorization_status <> 'authorized'
    OR NEW.writer_runtime NOT IN ('python', 'typescript')
  THEN
    UPDATE public.career_sources
    SET enabled = false, updated_at = clock_timestamp()
    WHERE provider = NEW.provider AND enabled;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS provider_registry_disable_sources ON public.provider_registry;
CREATE TRIGGER provider_registry_disable_sources
AFTER UPDATE ON public.provider_registry
FOR EACH ROW EXECUTE FUNCTION worker_private.disable_sources_after_provider_change();

ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS career_source_id uuid,
  ADD COLUMN IF NOT EXISTS run_mode text
    CHECK (run_mode IS NULL OR run_mode IN ('incremental', 'full_snapshot', 'census', 'shadow', 'dry_run', 'backfill')),
  ADD COLUMN IF NOT EXISTS normalized_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_in jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_out jsonb,
  ADD COLUMN IF NOT EXISTS requests_count integer NOT NULL DEFAULT 0 CHECK (requests_count >= 0),
  ADD COLUMN IF NOT EXISTS response_bytes bigint NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
  ADD COLUMN IF NOT EXISTS duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS request_cost_minor bigint CHECK (request_cost_minor IS NULL OR request_cost_minor >= 0),
  ADD COLUMN IF NOT EXISTS request_cost_currency text,
  ADD COLUMN IF NOT EXISTS actionable_records integer
    CHECK (actionable_records IS NULL OR actionable_records >= 0),
  ADD COLUMN IF NOT EXISTS planned_scope_token text,
  ADD COLUMN IF NOT EXISTS complete_scope_token text,
  ADD COLUMN IF NOT EXISTS accounting_residuals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT worker_runs_career_source_provider_guard CHECK (
    career_source_id IS NULL OR provider IS NOT NULL
  ),
  ADD CONSTRAINT worker_runs_career_source_provider_fk
    FOREIGN KEY (career_source_id, provider)
    REFERENCES public.career_sources(id, provider)
    ON DELETE RESTRICT,
  ADD CONSTRAINT worker_runs_source_metadata_json_guard CHECK (
    jsonb_typeof(normalized_scope) = 'object'
    AND (checkpoint_in IS NULL OR jsonb_typeof(checkpoint_in) = 'object')
    AND (checkpoint_out IS NULL OR jsonb_typeof(checkpoint_out) = 'object')
    AND jsonb_typeof(accounting_residuals) = 'object'
  ),
  ADD CONSTRAINT worker_runs_cost_currency_guard CHECK (
    (request_cost_minor IS NULL) = (request_cost_currency IS NULL)
    AND (request_cost_currency IS NULL OR request_cost_currency ~ '^[A-Z]{3}$')
  ),
  ADD CONSTRAINT worker_runs_complete_scope_token_guard CHECK (
    (planned_scope_token IS NULL OR length(btrim(planned_scope_token)) > 0)
    AND (complete_scope_token IS NULL OR length(btrim(complete_scope_token)) > 0)
    AND (
      complete_scope_token IS NULL
      OR (
        status = 'succeeded'
        AND completeness_state = 'complete_snapshot'
        AND complete_scope_token = planned_scope_token
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS worker_runs_complete_scope_token_unique
  ON public.worker_runs (complete_scope_token)
  WHERE complete_scope_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS worker_runs_career_source_finished_idx
  ON public.worker_runs (career_source_id, finished_at DESC)
  WHERE career_source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION worker_private.enforce_worker_run_scope_token_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.complete_scope_token IS NOT NULL AND (
    NEW.complete_scope_token IS DISTINCT FROM OLD.complete_scope_token
    OR NEW.planned_scope_token IS DISTINCT FROM OLD.planned_scope_token
    OR NEW.normalized_scope IS DISTINCT FROM OLD.normalized_scope
  ) THEN
    RAISE EXCEPTION 'completed source scope proof is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS worker_runs_scope_token_immutable ON public.worker_runs;
CREATE TRIGGER worker_runs_scope_token_immutable
BEFORE UPDATE ON public.worker_runs
FOR EACH ROW EXECUTE FUNCTION worker_private.enforce_worker_run_scope_token_immutability();

CREATE OR REPLACE FUNCTION worker_private.cohort_dimensions_are_safe(p_dimensions jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    jsonb_typeof(p_dimensions) = 'object'
    AND p_dimensions - ARRAY[
      'country_code',
      'subscription_tier',
      'experience_band',
      'activity_band',
      'inventory_segment'
    ] = '{}'::jsonb
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_dimensions) AS dimension(key, value)
      WHERE jsonb_typeof(value) NOT IN ('string', 'number', 'boolean', 'null')
         OR length(value #>> '{}') > 64
    )
$$;

CREATE TABLE IF NOT EXISTS public.paid_user_inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  hashed_user_id text NOT NULL CHECK (hashed_user_id ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz NOT NULL,
  cohort_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (worker_private.cohort_dimensions_are_safe(cohort_dimensions)),
  source_set text[] NOT NULL DEFAULT ARRAY[]::text[],
  freshness_window_days integer NOT NULL CHECK (freshness_window_days IN (1, 7, 30)),
  relevant_total integer NOT NULL CHECK (relevant_total >= 0),
  unique_total integer NOT NULL CHECK (unique_total >= 0),
  actionable_total integer NOT NULL CHECK (actionable_total >= 0),
  unseen_actionable_total integer NOT NULL CHECK (unseen_actionable_total >= 0),
  route_known_total integer NOT NULL CHECK (route_known_total >= 0),
  direct_employer_total integer NOT NULL CHECK (direct_employer_total >= 0),
  terminal_reason text NOT NULL CHECK (length(btrim(terminal_reason)) > 0),
  evaluator_version text NOT NULL CHECK (length(btrim(evaluator_version)) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT paid_user_inventory_snapshots_run_user_window_unique
    UNIQUE (coverage_run_id, hashed_user_id, freshness_window_days),
  CONSTRAINT paid_user_inventory_snapshots_count_guard CHECK (
    unique_total <= relevant_total
    AND actionable_total <= unique_total
    AND unseen_actionable_total <= actionable_total
    AND route_known_total <= relevant_total
    AND direct_employer_total <= relevant_total
  )
);

CREATE INDEX IF NOT EXISTS paid_user_inventory_snapshots_run_window_idx
  ON public.paid_user_inventory_snapshots (coverage_run_id, freshness_window_days);

CREATE TABLE IF NOT EXISTS public.paid_user_source_contributions (
  coverage_run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES public.career_sources(id) ON DELETE RESTRICT,
  canonical_group_id text NOT NULL CHECK (length(btrim(canonical_group_id)) > 0),
  affected_paid_users integer NOT NULL CHECK (affected_paid_users >= 0),
  incremental boolean NOT NULL,
  fresh boolean NOT NULL,
  relevant boolean NOT NULL,
  actionable boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (coverage_run_id, source_id, canonical_group_id)
);

CREATE TABLE IF NOT EXISTS public.france_travail_census_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  manifest_digest text NOT NULL UNIQUE CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz NOT NULL,
  partition_count integer NOT NULL CHECK (partition_count > 0),
  terminal_state text NOT NULL CHECK (
    terminal_state IN ('complete', 'capped', 'blocked', 'failed')
  ),
  source_reported_total integer
    CHECK (source_reported_total IS NULL OR source_reported_total >= 0),
  fetched_records integer NOT NULL CHECK (fetched_records >= 0),
  normalized_records integer NOT NULL CHECK (normalized_records >= 0),
  rejected_records integer NOT NULL CHECK (rejected_records >= 0),
  actionable_records integer NOT NULL CHECK (actionable_records >= 0),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT france_travail_census_accounting_guard CHECK (
    fetched_records = normalized_records + rejected_records
    AND actionable_records <= normalized_records
    AND (
      terminal_state <> 'complete'
      OR (
        source_reported_total IS NOT NULL
        AND fetched_records = source_reported_total
      )
    )
  )
);

CREATE TABLE IF NOT EXISTS public.france_travail_census_manifest_runs (
  manifest_id uuid NOT NULL
    REFERENCES public.france_travail_census_manifests(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  PRIMARY KEY (manifest_id, run_id)
);

CREATE OR REPLACE FUNCTION worker_private.reject_immutable_census_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'France Travail census evidence is immutable'
    USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS france_travail_census_manifests_immutable
  ON public.france_travail_census_manifests;
CREATE TRIGGER france_travail_census_manifests_immutable
BEFORE UPDATE OR DELETE ON public.france_travail_census_manifests
FOR EACH ROW EXECUTE FUNCTION worker_private.reject_immutable_census_evidence();

DROP TRIGGER IF EXISTS france_travail_census_manifest_runs_immutable
  ON public.france_travail_census_manifest_runs;
CREATE TRIGGER france_travail_census_manifest_runs_immutable
BEFORE UPDATE OR DELETE ON public.france_travail_census_manifest_runs
FOR EACH ROW EXECUTE FUNCTION worker_private.reject_immutable_census_evidence();

CREATE OR REPLACE VIEW public.career_source_activation_status
WITH (security_barrier = true)
AS
SELECT
  source.id AS source_id,
  source.provider,
  source.source_key,
  source.tenant_key,
  source.enabled,
  registry.authorization_status,
  registry.writer_runtime,
  policy.approval_status AS policy_status,
  policy.expires_at AS policy_expires_at,
  coalesce(
    source.enabled
    AND registry.enabled
    AND registry.authorization_status = 'authorized'
    AND registry.writer_runtime IN ('python', 'typescript')
    AND policy.enabled
    AND policy.approval_status = 'approved'
    AND policy.commercial_use_allowed
    AND policy.redisplay_allowed
    AND 'production' = ANY(policy.enabled_environments)
    AND policy.expires_at > clock_timestamp(),
    false
  ) AS production_eligible
FROM public.career_sources AS source
JOIN public.provider_registry AS registry ON registry.provider = source.provider
LEFT JOIN public.source_policy AS policy ON policy.id = source.policy_id;

CREATE OR REPLACE VIEW public.job_supply_source_baseline
WITH (security_barrier = true)
AS
SELECT
  provider,
  count(*)::bigint AS inventory_rows,
  count(DISTINCT external_id)::bigint AS provider_unique,
  count(*) FILTER (WHERE last_seen_at >= clock_timestamp() - interval '1 day')::bigint AS seen_1d,
  count(*) FILTER (WHERE last_seen_at >= clock_timestamp() - interval '7 days')::bigint AS seen_7d,
  count(*) FILTER (WHERE last_seen_at >= clock_timestamp() - interval '30 days')::bigint AS seen_30d,
  count(*) FILTER (
    WHERE selected_apply_url IS NOT NULL
      AND validation_status = 'valid'
      AND apply_fulfillment_status NOT IN ('blocked_expired', 'blocked_unavailable')
  )::bigint AS actionable,
  count(*) FILTER (
    WHERE coalesce(ats_provider, 'unknown') <> 'unknown'
       OR coalesce(apply_url_provider, 'unknown') <> 'unknown'
  )::bigint AS route_known,
  (
    1 - count(DISTINCT coalesce(fingerprint, job_id))::numeric
      / nullif(count(*), 0)
  )::numeric(8, 6) AS estimated_duplicate_rate
FROM public.jobs
GROUP BY provider;

CREATE OR REPLACE VIEW public.job_supply_ats_host_baseline
WITH (security_barrier = true)
AS
SELECT
  lower(regexp_replace(
    split_part(split_part(selected_apply_url, '://', 2), '/', 1),
    '^www\.',
    ''
  )) AS apply_host,
  coalesce(ats_provider, 'unknown') AS ats_provider,
  count(*)::bigint AS jobs,
  count(DISTINCT normalized_company)::bigint AS companies,
  count(*) FILTER (WHERE country_code = 'fr')::bigint AS france_jobs,
  count(*) FILTER (WHERE validation_status = 'valid')::bigint AS valid_jobs
FROM public.jobs
WHERE selected_apply_url IS NOT NULL
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.paid_user_inventory_baseline
WITH (security_barrier = true)
AS
SELECT
  coverage_run_id,
  freshness_window_days,
  count(*)::bigint AS paid_users,
  percentile_cont(0.1) WITHIN GROUP (ORDER BY unseen_actionable_total) AS p10,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY unseen_actionable_total) AS median,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY unseen_actionable_total) AS p90,
  avg((unseen_actionable_total = 0)::integer)::numeric(8, 6) AS exhaustion_rate
FROM public.paid_user_inventory_snapshots
GROUP BY coverage_run_id, freshness_window_days;

REVOKE ALL ON public.source_policy, public.career_sources,
  public.paid_user_inventory_snapshots, public.paid_user_source_contributions,
  public.france_travail_census_manifests, public.france_travail_census_manifest_runs
FROM PUBLIC;
REVOKE ALL ON public.career_source_activation_status,
  public.job_supply_source_baseline, public.job_supply_ats_host_baseline,
  public.paid_user_inventory_baseline
FROM PUBLIC;

GRANT SELECT ON public.source_policy, public.career_sources,
  public.paid_user_inventory_snapshots, public.paid_user_source_contributions,
  public.france_travail_census_manifests, public.france_travail_census_manifest_runs,
  public.career_source_activation_status, public.job_supply_source_baseline,
  public.job_supply_ats_host_baseline, public.paid_user_inventory_baseline
TO hirly_inventory_reader, hirly_inventory_operator;
GRANT INSERT ON public.paid_user_inventory_snapshots,
  public.paid_user_source_contributions, public.france_travail_census_manifests,
  public.france_travail_census_manifest_runs
TO hirly_inventory_operator;

COMMIT;
