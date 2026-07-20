-- TS_NEW: additive source-policy, disabled source metadata, and source-run observability.
-- This migration does not enable a source, authorize a provider, or transfer writer ownership.
BEGIN;

CREATE TABLE IF NOT EXISTS public.source_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  source_key text,
  approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'approved', 'blocked', 'expired')),
  licence_name text,
  licence_url text,
  commercial_use text NOT NULL DEFAULT 'unknown'
    CHECK (commercial_use IN ('unknown', 'allowed', 'restricted', 'prohibited')),
  redisplay text NOT NULL DEFAULT 'unknown'
    CHECK (redisplay IN ('unknown', 'allowed', 'restricted', 'prohibited')),
  full_text_retention text NOT NULL DEFAULT 'unknown'
    CHECK (full_text_retention IN ('unknown', 'allowed', 'restricted', 'prohibited')),
  attribution_template text,
  permitted_access_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_ref text,
  agreement_ref text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  reviewer text,
  enabled_environments text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_policy_id_provider_unique UNIQUE (id, provider),
  CONSTRAINT source_policy_source_key_guard CHECK (
    source_key IS NULL OR length(btrim(source_key)) > 0
  ),
  CONSTRAINT source_policy_environment_guard CHECK (
    enabled_environments <@ ARRAY['development', 'test', 'staging', 'production']::text[]
  ),
  CONSTRAINT source_policy_review_window_guard CHECK (
    expires_at IS NULL OR (reviewed_at IS NOT NULL AND expires_at > reviewed_at)
  ),
  CONSTRAINT source_policy_production_approval_guard CHECK (
    NOT ('production' = ANY(enabled_environments))
    OR (
      approval_status = 'approved'
      AND commercial_use = 'allowed'
      AND redisplay = 'allowed'
      AND cardinality(permitted_access_methods) > 0
      AND evidence_ref IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND reviewer IS NOT NULL
      AND expires_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS source_policy_provider_default_unique
  ON public.source_policy (provider)
  WHERE source_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS source_policy_provider_source_unique
  ON public.source_policy (provider, source_key)
  WHERE source_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.career_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (length(btrim(tenant_key)) > 0),
  company_id text,
  company_name text,
  country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  base_url text,
  access_type text NOT NULL
    CHECK (access_type IN ('public_api', 'open_data', 'tenant_feed', 'partner_feed')),
  policy_id uuid,
  sync_frequency interval CHECK (sync_frequency IS NULL OR sync_frequency > interval '0 seconds'),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(checkpoint) = 'object'),
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
  CONSTRAINT career_sources_provider_tenant_unique UNIQUE (provider, tenant_key),
  CONSTRAINT career_sources_policy_provider_fk
    FOREIGN KEY (policy_id, provider)
    REFERENCES public.source_policy(id, provider)
    ON DELETE RESTRICT,
  CONSTRAINT career_sources_attempt_order_guard CHECK (
    last_success_at IS NULL OR last_attempt_at IS NULL OR last_success_at <= last_attempt_at
  ),
  -- G008 is an observability/census foundation only. A later reviewed migration
  -- must replace this phase gate before any source can be scheduled.
  CONSTRAINT career_sources_foundation_disabled_guard CHECK (NOT enabled)
);

CREATE INDEX IF NOT EXISTS career_sources_provider_discovery_idx
  ON public.career_sources (provider, discovery_state, tenant_key);
CREATE INDEX IF NOT EXISTS career_sources_policy_idx
  ON public.career_sources (policy_id)
  WHERE policy_id IS NOT NULL;

ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS career_source_id uuid,
  ADD COLUMN IF NOT EXISTS source_mode text
    CHECK (source_mode IS NULL OR source_mode IN ('full', 'incremental', 'shadow', 'census', 'dry_run', 'backfill')),
  ADD COLUMN IF NOT EXISTS normalized_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_in jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_out jsonb,
  ADD COLUMN IF NOT EXISTS request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  ADD COLUMN IF NOT EXISTS response_bytes bigint NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
  ADD COLUMN IF NOT EXISTS cost_minor bigint CHECK (cost_minor IS NULL OR cost_minor >= 0),
  ADD COLUMN IF NOT EXISTS cost_currency text,
  ADD COLUMN IF NOT EXISTS planned_scope_token text,
  ADD COLUMN IF NOT EXISTS complete_scope_token text,
  ADD COLUMN IF NOT EXISTS named_residuals jsonb NOT NULL DEFAULT '{}'::jsonb,
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
    AND jsonb_typeof(named_residuals) = 'object'
  ),
  ADD CONSTRAINT worker_runs_cost_shape_guard CHECK (
    (cost_minor IS NULL) = (cost_currency IS NULL)
    AND (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$')
  ),
  ADD CONSTRAINT worker_runs_scope_token_guard CHECK (
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

CREATE OR REPLACE VIEW public.source_run_observability
WITH (security_barrier = true)
AS
SELECT
  run.id AS run_id,
  run.provider,
  run.career_source_id,
  source.tenant_key,
  run.source_mode,
  run.status,
  run.completeness_state,
  run.normalized_scope,
  run.request_count,
  run.response_bytes,
  run.cost_minor,
  run.cost_currency,
  run.named_residuals,
  run.requested_at,
  run.started_at,
  run.finished_at,
  source.enabled AS source_enabled,
  registry.authorization_status,
  registry.writer_runtime,
  policy.approval_status AS policy_status,
  policy.expires_at AS policy_expires_at,
  coalesce((
    policy.id IS NOT NULL
    AND policy.approval_status = 'approved'
    AND 'production' = ANY(policy.enabled_environments)
    AND policy.expires_at > clock_timestamp()
  ), false) AS policy_current,
  coalesce((
    run.status = 'succeeded'
    AND run.completeness_state = 'complete_snapshot'
    AND run.complete_scope_token IS NOT NULL
    AND run.complete_scope_token = run.planned_scope_token
    AND source.enabled
    AND registry.enabled
    AND registry.authorization_status = 'authorized'
    AND registry.writer_runtime IN ('python', 'typescript')
    AND policy.approval_status = 'approved'
    AND 'production' = ANY(policy.enabled_environments)
    AND policy.expires_at > clock_timestamp()
  ), false) AS reconciliation_eligible
FROM public.worker_runs AS run
LEFT JOIN public.career_sources AS source ON source.id = run.career_source_id
LEFT JOIN public.provider_registry AS registry ON registry.provider = source.provider
LEFT JOIN public.source_policy AS policy ON policy.id = source.policy_id;

REVOKE ALL ON public.source_policy, public.career_sources FROM PUBLIC;
REVOKE ALL ON public.source_run_observability FROM PUBLIC;
GRANT SELECT ON public.source_policy, public.career_sources, public.source_run_observability
  TO hirly_inventory_reader, hirly_inventory_operator;

COMMIT;
