BEGIN;
DROP VIEW IF EXISTS public.paid_user_inventory_baseline;
DROP VIEW IF EXISTS public.job_supply_ats_host_baseline;
DROP VIEW IF EXISTS public.job_supply_source_baseline;
DROP TRIGGER IF EXISTS france_travail_census_manifests_immutable
  ON public.france_travail_census_manifests;
DROP FUNCTION IF EXISTS worker_private.reject_immutable_census_manifest();
DROP TABLE IF EXISTS public.france_travail_census_manifests;
DROP TABLE IF EXISTS public.paid_user_inventory_snapshots;
DROP TABLE IF EXISTS public.source_policies;
DROP TABLE IF EXISTS public.career_sources;
ALTER TABLE public.worker_runs
  DROP COLUMN IF EXISTS actionable_records,
  DROP COLUMN IF EXISTS cost_microunits,
  DROP COLUMN IF EXISTS duration_ms,
  DROP COLUMN IF EXISTS requests_completed,
  DROP COLUMN IF EXISTS cursor,
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS run_mode;
COMMIT;
