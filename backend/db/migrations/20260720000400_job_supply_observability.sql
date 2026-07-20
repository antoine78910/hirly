-- Additive job-supply observability and France Travail census metadata.
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
  permitted_access_method text NOT NULL CHECK (length(btrim(permitted_access_method)) > 0),
  evidence_reference text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  reviewer text,
  enabled_environments text[] NOT NULL DEFAULT '{}'::text[],
  approval_status text NOT NULL DEFAULT 'unverified'
    CHECK (approval_status IN ('unverified', 'approved', 'blocked', 'expired')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_policy_key_unique UNIQUE (provider, policy_key),
  CONSTRAINT source_policy_enablement_guard CHECK (
    NOT enabled OR (
      approval_status = 'approved'
      AND evidence_reference IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at > reviewed_at)
    )
  )
);

CREATE TABLE IF NOT EXISTS public.career_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (length(btrim(tenant_key)) > 0),
  company_id text,
  company_name text,
  country_codes text[] NOT NULL DEFAULT '{}'::text[],
  base_url text,
  access_type text NOT NULL CHECK (length(btrim(access_type)) > 0),
  policy_id uuid REFERENCES public.source_policy(id) ON DELETE RESTRICT,
  sync_frequency interval,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_complete_run_id uuid REFERENCES public.worker_runs(id) ON DELETE SET NULL,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  enabled boolean NOT NULL DEFAULT false,
  discovery_state text NOT NULL DEFAULT 'candidate'
    CHECK (discovery_state IN ('candidate', 'validated', 'rejected', 'quarantined')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT career_sources_provider_tenant_unique UNIQUE (provider, tenant_key)
);

ALTER TABLE public.provider_registry
  ADD COLUMN IF NOT EXISTS default_sync_frequency interval,
  ADD COLUMN IF NOT EXISTS default_rate_limit_config jsonb NOT NULL
    DEFAULT '{"requestsPerMinute":1,"concurrency":1}'::jsonb,
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES public.source_policy(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS country_kill_switches jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capability_version text NOT NULL DEFAULT 'provider.v1';

ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS career_source_id uuid REFERENCES public.career_sources(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'production'
    CHECK (run_mode IN ('production', 'shadow', 'census', 'backfill')),
  ADD COLUMN IF NOT EXISTS normalized_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_in jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_out jsonb,
  ADD COLUMN IF NOT EXISTS requests_count integer NOT NULL DEFAULT 0 CHECK (requests_count >= 0),
  ADD COLUMN IF NOT EXISTS response_bytes bigint NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
  ADD COLUMN IF NOT EXISTS request_cost_minor bigint NOT NULL DEFAULT 0 CHECK (request_cost_minor >= 0),
  ADD COLUMN IF NOT EXISTS request_cost_currency text,
  ADD COLUMN IF NOT EXISTS complete_scope_token text,
  ADD COLUMN IF NOT EXISTS accounting_residuals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT worker_runs_cost_currency_guard CHECK (
    (request_cost_minor = 0 AND request_cost_currency IS NULL)
    OR request_cost_currency ~ '^[A-Z]{3}$'
  ),
  ADD CONSTRAINT worker_runs_complete_scope_token_guard CHECK (
    complete_scope_token IS NULL
    OR (status = 'succeeded' AND completeness_state = 'complete_snapshot')
  );

CREATE UNIQUE INDEX IF NOT EXISTS worker_runs_complete_scope_token_unique
  ON public.worker_runs (complete_scope_token)
  WHERE complete_scope_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.france_travail_census_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  manifest_version text NOT NULL CHECK (length(btrim(manifest_version)) > 0),
  manifest_digest text NOT NULL UNIQUE CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  paid_cohort_snapshot_at timestamptz NOT NULL,
  paid_cohort_snapshot_hash text NOT NULL CHECK (paid_cohort_snapshot_hash ~ '^[0-9a-f]{64}$'),
  profile_strata jsonb NOT NULL,
  sampling_seed text NOT NULL CHECK (length(btrim(sampling_seed)) > 0),
  cap_rules jsonb NOT NULL,
  publication_window_rules jsonb NOT NULL,
  partitions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT france_travail_census_manifest_shape CHECK (
    jsonb_typeof(profile_strata) = 'array'
    AND jsonb_typeof(cap_rules) = 'object'
    AND jsonb_typeof(publication_window_rules) = 'object'
    AND jsonb_typeof(partitions) = 'array'
  )
);

CREATE TABLE IF NOT EXISTS public.paid_user_inventory_snapshots (
  coverage_run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  user_hash text NOT NULL CHECK (user_hash ~ '^[0-9a-f]{64}$'),
  cohort_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL,
  source_set text[] NOT NULL DEFAULT '{}'::text[],
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
  PRIMARY KEY (coverage_run_id, user_hash, freshness_window_days),
  CONSTRAINT paid_user_inventory_monotonic_guard CHECK (
    unseen_actionable_total <= actionable_total
    AND actionable_total <= relevant_total
    AND relevant_total <= unique_total
  )
);

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

CREATE OR REPLACE FUNCTION public.assert_job_supply_observability_topology()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'enabled_career_sources', (SELECT count(*) FROM public.career_sources WHERE enabled),
    'enabled_source_policies', (SELECT count(*) FROM public.source_policy WHERE enabled),
    'typescript_writers', (
      SELECT count(*) FROM public.provider_registry
      WHERE enabled AND writer_runtime = 'typescript'
    ),
    'provider_registry_is_writer_authority', true
  )
$$;

REVOKE ALL ON public.source_policy, public.career_sources,
  public.france_travail_census_manifests, public.paid_user_inventory_snapshots,
  public.paid_user_source_contributions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_job_supply_observability_topology() FROM PUBLIC;

GRANT SELECT ON public.source_policy, public.career_sources,
  public.france_travail_census_manifests, public.paid_user_inventory_snapshots,
  public.paid_user_source_contributions TO hirly_inventory_reader, hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION public.assert_job_supply_observability_topology()
  TO hirly_inventory_reader, hirly_inventory_operator;

COMMIT;
