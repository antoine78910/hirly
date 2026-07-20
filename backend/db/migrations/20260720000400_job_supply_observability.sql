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
  coverage_run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  hashed_user_id text NOT NULL CHECK (hashed_user_id ~ '^[a-f0-9]{64}$'),
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

REVOKE ALL ON public.career_sources, public.source_policies,
  public.paid_user_inventory_snapshots, public.france_travail_census_manifests,
  public.france_travail_census_manifest_runs
FROM PUBLIC;
REVOKE ALL ON public.job_supply_source_baseline, public.job_supply_ats_host_baseline,
  public.paid_user_inventory_baseline
FROM PUBLIC;

GRANT SELECT ON public.career_sources, public.source_policies,
  public.paid_user_inventory_snapshots, public.france_travail_census_manifests,
  public.france_travail_census_manifest_runs,
  public.job_supply_source_baseline, public.job_supply_ats_host_baseline,
  public.paid_user_inventory_baseline
TO hirly_inventory_reader, hirly_inventory_operator;
GRANT INSERT ON public.paid_user_inventory_snapshots,
  public.france_travail_census_manifests, public.france_travail_census_manifest_runs
TO hirly_inventory_operator;

COMMIT;
