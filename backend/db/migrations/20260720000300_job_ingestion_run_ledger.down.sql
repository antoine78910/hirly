BEGIN;
DROP FUNCTION IF EXISTS public.python_ingestion_run_complete(uuid, uuid, bigint, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.python_ingestion_partition_record(uuid, uuid, bigint, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.python_ingestion_run_heartbeat(uuid, uuid, bigint, text, integer);
DROP FUNCTION IF EXISTS public.python_ingestion_run_begin(text, text, integer, text, integer);
DROP FUNCTION IF EXISTS public.python_ingestion_schedule_sync(text, text, integer, boolean);
DROP VIEW IF EXISTS public.worker_ingestion_alerts;
DROP TABLE IF EXISTS public.worker_run_partitions;
DROP TABLE IF EXISTS public.python_ingestion_schedules;
DROP INDEX IF EXISTS public.worker_runs_python_source_running_unique;
ALTER TABLE public.worker_runs
  DROP CONSTRAINT IF EXISTS worker_runs_normalization_guard,
  DROP CONSTRAINT IF EXISTS worker_runs_page_accounting_guard,
  DROP COLUMN IF EXISTS completeness_state,
  DROP COLUMN IF EXISTS jobs_marked_inactive,
  DROP COLUMN IF EXISTS jobs_reactivated,
  DROP COLUMN IF EXISTS jobs_updated,
  DROP COLUMN IF EXISTS jobs_inserted,
  DROP COLUMN IF EXISTS fuzzy_duplicate_candidates,
  DROP COLUMN IF EXISTS exact_duplicates,
  DROP COLUMN IF EXISTS rejected_by_reason,
  DROP COLUMN IF EXISTS normalized_records,
  DROP COLUMN IF EXISTS raw_records,
  DROP COLUMN IF EXISTS source_reported_total,
  DROP COLUMN IF EXISTS retries,
  DROP COLUMN IF EXISTS pages_completed,
  DROP COLUMN IF EXISTS pages_requested,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_generation,
  DROP COLUMN IF EXISTS lease_token,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS scheduled_start;
COMMIT;
