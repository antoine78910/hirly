BEGIN;
DROP INDEX IF EXISTS public.job_search_documents_active_facets_idx;
DROP INDEX IF EXISTS public.candidate_search_profiles_active_facets_idx;
ALTER TABLE public.job_search_documents
  DROP COLUMN IF EXISTS industry_ids,
  DROP COLUMN IF EXISTS sector_ids;
ALTER TABLE public.candidate_search_profiles
  DROP COLUMN IF EXISTS industry_ids,
  DROP COLUMN IF EXISTS sector_ids,
  DROP COLUMN IF EXISTS target_role_labels_normalized;
COMMIT;
