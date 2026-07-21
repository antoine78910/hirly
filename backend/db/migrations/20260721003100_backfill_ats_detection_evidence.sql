-- TS_MIGRATION: retain observed ATS evidence without expanding the fulfilment-safe catalogue.
BEGIN;

-- This is an atomic, migration-owned metadata repair. Normal provider writes
-- remain guarded by worker_private.write_jobs_and_complete.
ALTER TABLE public.jobs DISABLE TRIGGER jobs_claimed_provider_write_guard;

WITH classified AS (
  SELECT
    job_id,
    lower(regexp_replace(selected_apply_url, '^https?://([^/]+).*$', '\\1')) AS host
  FROM public.jobs
  WHERE coalesce(ats_provider, 'unknown') = 'unknown'
    AND selected_apply_url ~* '^https?://[^/]+'
), evidence AS (
  SELECT
    job_id,
    host,
    CASE
      WHEN host = 'grnh.se' THEN 'greenhouse'
      WHEN host = 'applytojob.com' OR host LIKE '%.applytojob.com' THEN 'bamboohr'
      ELSE NULL
    END AS catalogued_provider,
    CASE
      WHEN host = 'zohorecruit.com' OR host LIKE '%.zohorecruit.com'
        OR host = 'zohorecruit.eu' OR host LIKE '%.zohorecruit.eu'
        THEN 'zoho_recruit'
      WHEN host LIKE '%.oraclecloud.com'
        AND (host LIKE '%.fa.%' OR host LIKE 'fa-%')
        THEN 'oracle_fusion_hcm'
      WHEN host = 'gohiring.com' OR host LIKE '%.gohiring.com' THEN 'gohiring'
      WHEN host = 'occupop.com' OR host LIKE '%.occupop.com' THEN 'occupop'
      WHEN host = 'careers-page.com' OR host LIKE '%.careers-page.com' THEN 'careers_page'
      WHEN host = 'taleo.net' OR host LIKE '%.taleo.net' THEN 'oracle_taleo'
      ELSE NULL
    END AS provider_hint
  FROM classified
)
UPDATE public.jobs AS job
SET
  ats_provider = coalesce(evidence.catalogued_provider, job.ats_provider),
  apply_url_provider = coalesce(evidence.catalogued_provider, job.apply_url_provider),
  data = coalesce(job.data, '{}'::jsonb) || jsonb_build_object(
    'atsDetection',
    jsonb_build_object(
      'status', CASE
        WHEN evidence.catalogued_provider IS NOT NULL THEN 'catalogued'
        WHEN evidence.provider_hint IS NOT NULL THEN 'unmanaged'
        ELSE 'unclassified'
      END,
      'host', evidence.host,
      'provider', evidence.catalogued_provider,
      'providerHint', evidence.provider_hint,
      'match', CASE
        WHEN evidence.catalogued_provider IS NOT NULL THEN 'provider_only'
        ELSE 'unknown'
      END
    )
  )
FROM evidence
WHERE job.job_id = evidence.job_id;

ALTER TABLE public.jobs ENABLE TRIGGER jobs_claimed_provider_write_guard;

COMMIT;
