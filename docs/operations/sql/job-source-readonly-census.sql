-- Read-only current-inventory census. This query performs no provider fetch,
-- source activation, writer transfer, or canonical mutation.
WITH inventory AS (
  SELECT
    jobs.*,
    coalesce(nullif(jobs.fingerprint, ''), jobs.job_id) AS unique_key,
    greatest(
      coalesce(jobs.last_seen_at, '-infinity'::timestamptz),
      coalesce(jobs.imported_at, '-infinity'::timestamptz),
      coalesce(jobs.posted_at, '-infinity'::timestamptz)
    ) AS freshness_at,
    (
      jobs.selected_apply_url IS NOT NULL
      AND btrim(jobs.selected_apply_url) <> ''
      AND coalesce(jobs.validation_status, '') <> 'invalid'
      AND coalesce(jobs.applyability_tier, '') NOT IN ('D', 'E')
      AND NOT coalesce(jobs.requires_login, false)
      AND NOT coalesce(jobs.requires_account_creation, false)
      AND NOT coalesce(jobs.captcha_detected, false)
      AND (
        (
          jobs.validation_status = 'valid'
          AND jobs.applyability_tier IN ('A', 'B')
        )
        OR (
          lower(coalesce(jobs.provider, '')) IN (
            'greenhouse',
            'lever',
            'ashby'
          )
          AND jobs.auto_apply_supported IS true
        )
      )
    ) AS system_auto_applicable
  FROM public.jobs
)
SELECT
  lower(inventory.ats_provider) AS ats_provider,
  count(DISTINCT inventory.unique_key) AS observed_unique_jobs,
  count(DISTINCT inventory.unique_key) FILTER (
    WHERE inventory.freshness_at >= now() - interval '30 days'
  ) AS observed_fresh_30d,
  count(DISTINCT inventory.unique_key) FILTER (
    WHERE inventory.system_auto_applicable
  ) AS auto_applicable,
  count(
    DISTINCT coalesce(
      nullif(inventory.normalized_company, ''),
      nullif(inventory.company, '')
    )
  ) AS observed_companies
FROM inventory
WHERE lower(coalesce(inventory.ats_provider, '')) IN (
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'teamtailor',
  'taleez',
  'recruitee',
  'personio',
  'workable'
)
GROUP BY lower(inventory.ats_provider)
ORDER BY observed_unique_jobs DESC;
