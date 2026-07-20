BEGIN;
DROP VIEW IF EXISTS public.paid_user_inventory_baseline;
DROP VIEW IF EXISTS public.job_supply_ats_host_baseline;
DROP VIEW IF EXISTS public.job_supply_source_baseline;
DROP TRIGGER IF EXISTS france_travail_census_manifests_immutable
  ON public.france_travail_census_manifests;
DROP TRIGGER IF EXISTS france_travail_census_manifest_runs_immutable
  ON public.france_travail_census_manifest_runs;
DROP FUNCTION IF EXISTS worker_private.reject_immutable_census_evidence();
DROP TABLE IF EXISTS public.france_travail_census_manifest_runs;
DROP TABLE IF EXISTS public.france_travail_census_manifests;
DROP TABLE IF EXISTS public.paid_user_inventory_snapshots;
DROP TABLE IF EXISTS public.france_travail_census_manifests;

DROP INDEX IF EXISTS public.worker_runs_complete_scope_token_unique;
ALTER TABLE public.worker_runs
  DROP CONSTRAINT IF EXISTS worker_runs_complete_scope_token_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_cost_currency_guard,
  DROP COLUMN IF EXISTS accounting_residuals,
  DROP COLUMN IF EXISTS complete_scope_token,
  DROP COLUMN IF EXISTS request_cost_currency,
  DROP COLUMN IF EXISTS request_cost_minor,
  DROP COLUMN IF EXISTS response_bytes,
  DROP COLUMN IF EXISTS requests_count,
  DROP COLUMN IF EXISTS checkpoint_out,
  DROP COLUMN IF EXISTS checkpoint_in,
  DROP COLUMN IF EXISTS normalized_scope,
  DROP COLUMN IF EXISTS run_mode,
  DROP COLUMN IF EXISTS career_source_id;

ALTER TABLE public.provider_registry
  DROP COLUMN IF EXISTS capability_version,
  DROP COLUMN IF EXISTS country_kill_switches,
  DROP COLUMN IF EXISTS policy_id,
  DROP COLUMN IF EXISTS default_rate_limit_config,
  DROP COLUMN IF EXISTS default_sync_frequency;

DROP TABLE IF EXISTS public.career_sources;
DROP TABLE IF EXISTS public.source_policy;

COMMIT;
