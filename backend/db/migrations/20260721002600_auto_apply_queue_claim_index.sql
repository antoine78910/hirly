CREATE INDEX CONCURRENTLY IF NOT EXISTS applications_auto_apply_queue_claim_idx
ON public.applications (
  (data ->> 'auto_apply_queued_at') ASC NULLS LAST,
  created_at ASC NULLS LAST,
  application_id ASC
)
WHERE data ->> 'auto_apply_queue_status' = 'queued';
