-- TS_NEW: additive job-supply observability and immutable France Travail census evidence.
-- provider_registry remains the sole canonical-writer authority. This migration does not
-- enable a provider, schedule, source, or writer.
BEGIN;

ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'incremental'
    CHECK (run_mode IN ('incremental', 'full_snapshot', 'census', 'shadow')),
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(scope) = 'object'),
  ADD COLUMN IF NOT EXISTS cursor jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(cursor) = 'object'),
  ADD COLUMN IF NOT EXISTS requests_completed integer NOT NULL DEFAULT 0
    CHECK (requests_completed >= 0),
  ADD COLUMN IF NOT EXISTS duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS cost_microunits bigint CHECK (cost_microunits IS NULL OR cost_microunits >= 0),
  ADD COLUMN IF NOT EXISTS actionable_records integer
    CHECK (actionable_records IS NULL OR actionable_records >= 0);

CREATE TABLE IF NOT EXISTS public.career_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (length(btrim(source_key)) > 0),
  source_type text NOT NULL CHECK (
    source_type IN ('provider', 'ats_tenant', 'career_page', 'open_data')
  ),
  tenant_key text,
  country_code text CHECK (country_code IS NULL OR country_code ~ '^[a-z]{2}$'),
  base_url text,
  collection_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT career_sources_provider_key_unique UNIQUE (provider, source_key),
  CONSTRAINT career_sources_disabled_guard CHECK (collection_enabled = false)
);

CREATE TABLE IF NOT EXISTS public.source_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL UNIQUE REFERENCES public.career_sources(id) ON DELETE RESTRICT,
  policy_status text NOT NULL DEFAULT 'unverified'
    CHECK (policy_status IN ('unverified', 'approved', 'blocked', 'expired')),
  evidence_ref text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  allowed_uses jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_uses) = 'array'),
  production_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_policies_disabled_guard CHECK (production_enabled = false),
  CONSTRAINT source_policies_evidence_guard CHECK (
    policy_status <> 'approved'
    OR (
      evidence_ref IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at > reviewed_at)
    )
  )
);

CREATE TABLE IF NOT EXISTS public.paid_user_inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_run_id uuid NOT NULL,
  hashed_user_id text NOT NULL CHECK (hashed_user_id ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz NOT NULL,
  cohort_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(cohort_dimensions) = 'object'),
  source_set text[] NOT NULL DEFAULT '{}',
  freshness_window_days integer NOT NULL CHECK (freshness_window_days IN (1, 7, 30)),
  relevant_total integer NOT NULL CHECK (relevant_total >= 0),
  unique_total integer NOT NULL CHECK (unique_total >= 0),
  actionable_total integer NOT NULL CHECK (actionable_total >= 0),
  unseen_actionable_total integer NOT NULL CHECK (unseen_actionable_total >= 0),
  route_known_total integer NOT NULL CHECK (route_known_total >= 0),
  direct_employer_total integer NOT NULL CHECK (direct_employer_total >= 0),
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

CREATE TABLE IF NOT EXISTS public.france_travail_census_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  manifest_digest text NOT NULL UNIQUE CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz NOT NULL,
  source_run_ids uuid[] NOT NULL CHECK (cardinality(source_run_ids) > 0),
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
      OR source_reported_total IS NULL
      OR fetched_records = source_reported_total
    )
  )
);

CREATE OR REPLACE FUNCTION worker_private.reject_immutable_census_manifest()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'France Travail census manifests are immutable'
    USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS france_travail_census_manifests_immutable
  ON public.france_travail_census_manifests;
CREATE TRIGGER france_travail_census_manifests_immutable
BEFORE UPDATE OR DELETE ON public.france_travail_census_manifests
FOR EACH ROW EXECUTE FUNCTION worker_private.reject_immutable_census_manifest();

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
  public.paid_user_inventory_snapshots, public.france_travail_census_manifests
FROM PUBLIC;
REVOKE ALL ON public.job_supply_source_baseline, public.job_supply_ats_host_baseline,
  public.paid_user_inventory_baseline
FROM PUBLIC;

GRANT SELECT ON public.career_sources, public.source_policies,
  public.paid_user_inventory_snapshots, public.france_travail_census_manifests,
  public.job_supply_source_baseline, public.job_supply_ats_host_baseline,
  public.paid_user_inventory_baseline
TO hirly_inventory_reader, hirly_inventory_operator;
GRANT INSERT ON public.paid_user_inventory_snapshots,
  public.france_travail_census_manifests
TO hirly_inventory_operator;

COMMIT;
