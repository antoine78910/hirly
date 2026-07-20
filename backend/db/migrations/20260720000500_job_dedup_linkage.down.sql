BEGIN;
DROP TABLE IF EXISTS public.job_dedup_candidates;
DROP INDEX IF EXISTS public.jobs_fingerprint_candidate_idx;
DROP INDEX IF EXISTS public.jobs_ats_occurrence_candidate_idx;
DROP INDEX IF EXISTS public.jobs_canonical_apply_url_candidate_idx;
ALTER TABLE public.jobs
  DROP COLUMN IF EXISTS ats_job_id,
  DROP COLUMN IF EXISTS canonical_apply_url;
COMMIT;
