BEGIN;
DROP VIEW IF EXISTS public.worker_ingestion_alerts;
DROP TABLE IF EXISTS public.worker_run_partitions;
ALTER TABLE public.worker_runs
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
  DROP COLUMN IF EXISTS scheduled_start;
COMMIT;
