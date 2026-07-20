BEGIN;

DROP VIEW IF EXISTS public.paid_user_inventory_baseline;
DROP VIEW IF EXISTS public.job_supply_ats_host_baseline;
DROP VIEW IF EXISTS public.job_supply_source_baseline;
DROP VIEW IF EXISTS public.career_source_activation_status;

DROP TRIGGER IF EXISTS france_travail_census_manifest_runs_immutable
  ON public.france_travail_census_manifest_runs;
DROP TRIGGER IF EXISTS france_travail_census_manifests_immutable
  ON public.france_travail_census_manifests;
DROP FUNCTION IF EXISTS worker_private.reject_immutable_census_evidence();

DROP TABLE IF EXISTS public.france_travail_census_manifest_runs;
DROP TABLE IF EXISTS public.france_travail_census_manifests;
DROP TABLE IF EXISTS public.paid_user_source_contributions;
DROP TABLE IF EXISTS public.paid_user_inventory_snapshots;
DROP FUNCTION IF EXISTS worker_private.cohort_dimensions_are_safe(jsonb);

DROP TRIGGER IF EXISTS worker_runs_scope_token_immutable ON public.worker_runs;
DROP FUNCTION IF EXISTS worker_private.enforce_worker_run_scope_token_immutability();
DROP INDEX IF EXISTS public.worker_runs_career_source_finished_idx;
DROP INDEX IF EXISTS public.worker_runs_complete_scope_token_unique;

ALTER TABLE public.worker_runs
  DROP CONSTRAINT IF EXISTS worker_runs_complete_scope_token_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_cost_currency_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_source_metadata_json_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_career_source_provider_fk,
  DROP CONSTRAINT IF EXISTS worker_runs_career_source_provider_guard,
  DROP COLUMN IF EXISTS accounting_residuals,
  DROP COLUMN IF EXISTS complete_scope_token,
  DROP COLUMN IF EXISTS planned_scope_token,
  DROP COLUMN IF EXISTS actionable_records,
  DROP COLUMN IF EXISTS request_cost_currency,
  DROP COLUMN IF EXISTS request_cost_minor,
  DROP COLUMN IF EXISTS duration_ms,
  DROP COLUMN IF EXISTS response_bytes,
  DROP COLUMN IF EXISTS requests_count,
  DROP COLUMN IF EXISTS checkpoint_out,
  DROP COLUMN IF EXISTS checkpoint_in,
  DROP COLUMN IF EXISTS normalized_scope,
  DROP COLUMN IF EXISTS run_mode,
  DROP COLUMN IF EXISTS career_source_id;

DROP TRIGGER IF EXISTS provider_registry_disable_sources ON public.provider_registry;
DROP FUNCTION IF EXISTS worker_private.disable_sources_after_provider_change();
DROP TRIGGER IF EXISTS source_policy_disable_sources ON public.source_policy;
DROP FUNCTION IF EXISTS worker_private.disable_sources_after_policy_change();
DROP TRIGGER IF EXISTS career_source_activation_guard ON public.career_sources;
DROP FUNCTION IF EXISTS worker_private.enforce_career_source_activation();
DROP TABLE IF EXISTS public.career_sources;

ALTER TABLE public.provider_registry
  DROP CONSTRAINT IF EXISTS provider_registry_policy_provider_fk,
  DROP CONSTRAINT IF EXISTS provider_registry_capability_version_guard,
  DROP CONSTRAINT IF EXISTS provider_registry_country_kill_switches_guard,
  DROP CONSTRAINT IF EXISTS provider_registry_default_rate_limit_guard,
  DROP COLUMN IF EXISTS capability_version,
  DROP COLUMN IF EXISTS country_kill_switches,
  DROP COLUMN IF EXISTS policy_id,
  DROP COLUMN IF EXISTS default_rate_limit_config,
  DROP COLUMN IF EXISTS default_sync_frequency;

DROP TRIGGER IF EXISTS source_policy_activation_guard ON public.source_policy;
DROP FUNCTION IF EXISTS worker_private.enforce_source_policy_activation();
DROP TABLE IF EXISTS public.source_policy;

COMMIT;
