BEGIN;

DROP FUNCTION IF EXISTS worker_private.career_source_runnable(uuid, text, text);
REVOKE SELECT ON public.provider_registry FROM hirly_inventory_operator;
DROP VIEW IF EXISTS public.career_source_runtime_status;
DROP VIEW IF EXISTS public.raw_job_snapshot_metadata;

DROP TRIGGER IF EXISTS canonical_job_group_events_immutable
  ON public.canonical_job_group_events;
DROP TABLE IF EXISTS public.canonical_job_group_events;
DROP TABLE IF EXISTS public.canonical_job_group_members;
DROP TABLE IF EXISTS public.job_occurrences;

DROP INDEX IF EXISTS public.jobs_source_active_idx;
DROP INDEX IF EXISTS public.jobs_canonical_group_feed_idx;
ALTER TABLE public.jobs
  DROP COLUMN IF EXISTS route_verified_at,
  DROP COLUMN IF EXISTS route_confidence,
  DROP COLUMN IF EXISTS route_classification,
  DROP COLUMN IF EXISTS lifecycle_checked_at,
  DROP COLUMN IF EXISTS lifecycle_state,
  DROP COLUMN IF EXISTS removed_at,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS first_seen_at,
  DROP COLUMN IF EXISTS canonical_group_id,
  DROP COLUMN IF EXISTS source_id;

DROP TABLE IF EXISTS public.canonical_job_groups;

DROP TRIGGER IF EXISTS raw_job_snapshots_immutable ON public.raw_job_snapshots;
DROP TABLE IF EXISTS public.raw_job_snapshots;
DROP FUNCTION IF EXISTS worker_private.reject_immutable_source_evidence();

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_occurrence_identity_unique;
ALTER TABLE public.worker_runs
  DROP CONSTRAINT IF EXISTS worker_runs_source_identity_unique;

ALTER TABLE public.career_sources
  DROP CONSTRAINT IF EXISTS career_sources_policy_identity_unique,
  DROP CONSTRAINT IF EXISTS career_sources_country_codes_guard,
  DROP CONSTRAINT IF EXISTS career_sources_country_kill_switches_guard,
  DROP COLUMN IF EXISTS country_kill_switches,
  DROP COLUMN IF EXISTS backfill_enabled,
  DROP COLUMN IF EXISTS incremental_enabled,
  DROP COLUMN IF EXISTS transport_enabled;

ALTER TABLE public.provider_registry
  DROP CONSTRAINT IF EXISTS provider_registry_country_kill_switch_values_guard;

DROP FUNCTION IF EXISTS worker_private.kill_switch_map_is_valid(jsonb);
DROP FUNCTION IF EXISTS worker_private.country_code_array_is_valid(text[]);

COMMIT;
