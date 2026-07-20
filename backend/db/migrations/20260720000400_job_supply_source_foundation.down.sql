BEGIN;

DROP VIEW IF EXISTS public.source_run_observability;
DROP TRIGGER IF EXISTS worker_runs_scope_token_immutable ON public.worker_runs;
DROP FUNCTION IF EXISTS worker_private.enforce_worker_run_scope_token_immutability();
DROP INDEX IF EXISTS public.worker_runs_career_source_finished_idx;

ALTER TABLE public.worker_runs
  DROP CONSTRAINT IF EXISTS worker_runs_career_source_provider_fk,
  DROP CONSTRAINT IF EXISTS worker_runs_career_source_provider_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_scope_token_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_cost_shape_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_source_metadata_json_guard,
  DROP COLUMN IF EXISTS named_residuals,
  DROP COLUMN IF EXISTS complete_scope_token,
  DROP COLUMN IF EXISTS planned_scope_token,
  DROP COLUMN IF EXISTS cost_currency,
  DROP COLUMN IF EXISTS cost_minor,
  DROP COLUMN IF EXISTS response_bytes,
  DROP COLUMN IF EXISTS request_count,
  DROP COLUMN IF EXISTS checkpoint_out,
  DROP COLUMN IF EXISTS checkpoint_in,
  DROP COLUMN IF EXISTS normalized_scope,
  DROP COLUMN IF EXISTS source_mode,
  DROP COLUMN IF EXISTS career_source_id;

DROP TABLE IF EXISTS public.career_sources;
DROP TABLE IF EXISTS public.source_policy;

COMMIT;
