-- TS_NEW: Feed v2 serving indexes.  This migration is deliberately non-transactional
-- so the indexes can be built online without blocking the active inventory reader.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_search_documents_active_recency_idx
  ON public.job_search_documents (last_seen_at DESC, canonical_group_id ASC)
  WHERE lifecycle_status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_search_documents_active_projected_idx
  ON public.job_search_documents (projected_at DESC)
  WHERE lifecycle_status = 'active';
