-- TEST/LOCAL rollback only. Drop Feed v2 serving indexes online.
DROP INDEX CONCURRENTLY IF EXISTS public.job_search_documents_active_projected_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.job_search_documents_active_recency_idx;
