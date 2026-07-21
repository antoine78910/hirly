-- Additive matching facets. The TypeScript worker remains the sole writer.
BEGIN;

ALTER TABLE public.candidate_search_profiles
  ADD COLUMN IF NOT EXISTS target_role_labels_normalized text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS sector_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS industry_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.job_search_documents
  ADD COLUMN IF NOT EXISTS sector_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS industry_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS candidate_search_profiles_active_facets_idx
  ON public.candidate_search_profiles USING gin (role_family_ids, sector_ids, industry_ids)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS job_search_documents_active_facets_idx
  ON public.job_search_documents USING gin (role_family_codes, sector_ids, industry_ids)
  WHERE lifecycle_status = 'active';

COMMIT;
