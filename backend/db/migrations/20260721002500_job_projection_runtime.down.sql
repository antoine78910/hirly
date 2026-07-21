-- TEST/LOCAL rollback only. Disable projection controls and drain leases first.
BEGIN;

DROP FUNCTION IF EXISTS worker_private.enqueue_job_projection_reconciliation(integer);
DROP FUNCTION IF EXISTS worker_private.complete_job_projection_remove(uuid, uuid, bigint, text, uuid, bigint, integer);
DROP FUNCTION IF EXISTS worker_private.complete_job_projection_upsert(uuid, uuid, bigint, text, jsonb, text, integer);
DROP FUNCTION IF EXISTS worker_private.finish_job_projection_task(uuid, uuid, bigint, text, text, text, text, timestamptz, integer);
DROP FUNCTION IF EXISTS worker_private.read_job_projection_source(uuid, uuid, bigint, text);
DROP FUNCTION IF EXISTS worker_private.heartbeat_job_projection_task(uuid, uuid, bigint, text, integer);
DROP FUNCTION IF EXISTS worker_private.claim_job_projection_tasks(text, integer, integer);
DROP FUNCTION IF EXISTS worker_private.enqueue_current_job_projection_task(uuid, text);
DROP FUNCTION IF EXISTS worker_private.job_projection_source_digest(uuid);

DROP TABLE IF EXISTS public.job_projection_task_audit;

ALTER TABLE public.job_search_documents
  DROP COLUMN IF EXISTS source_content_hash,
  DROP COLUMN IF EXISTS source_snapshot_digest,
  DROP COLUMN IF EXISTS source_updated_at;
ALTER TABLE public.projection_reconciliation_tasks
  DROP COLUMN IF EXISTS last_error_message,
  DROP COLUMN IF EXISTS source_digest,
  DROP COLUMN IF EXISTS claim_generation;

-- Canonical jobs/groups/occurrences and the PR1 projection tables are retained.
COMMIT;
