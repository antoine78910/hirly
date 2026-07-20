-- TS_NEW: additive, review-only cross-source occurrence linkage.
BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS canonical_apply_url text,
  ADD COLUMN IF NOT EXISTS ats_job_id text;

CREATE INDEX IF NOT EXISTS jobs_canonical_apply_url_candidate_idx
  ON public.jobs (canonical_apply_url, job_id)
  WHERE canonical_apply_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_ats_occurrence_candidate_idx
  ON public.jobs (ats_provider, ats_job_id, job_id)
  WHERE ats_provider IS NOT NULL AND ats_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_fingerprint_candidate_idx
  ON public.jobs (fingerprint, job_id)
  WHERE fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.job_dedup_candidates (
  candidate_id text PRIMARY KEY,
  left_job_id text NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  right_job_id text NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  candidate_type text NOT NULL CHECK (
    candidate_type IN ('canonical_url_candidate', 'ats_id_candidate', 'fingerprint_candidate')
  ),
  candidate_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (left_job_id < right_job_id),
  UNIQUE (left_job_id, right_job_id, candidate_type, candidate_key)
);

CREATE INDEX IF NOT EXISTS job_dedup_candidates_key_idx
  ON public.job_dedup_candidates (candidate_type, candidate_key, last_seen_at DESC);

COMMIT;
