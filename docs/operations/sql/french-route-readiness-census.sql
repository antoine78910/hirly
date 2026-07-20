\set ON_ERROR_STOP on
\if :{?generated_at}
\else
\echo 'generated_at is required (ISO-8601 UTC timestamp)'
\quit 3
\endif
\if :{?freshness_cutoff}
\else
\echo 'freshness_cutoff is required (ISO-8601 UTC timestamp)'
\quit 3
\endif

-- G018 read-only, aggregate-only French route-readiness census.
-- The runtime-ready provider set must stay reconciled with
-- packages/ingestion/src/application-capabilities.json.
WITH parameters AS (
  SELECT
    :'generated_at'::timestamptz AS generated_at,
    :'freshness_cutoff'::timestamptz AS freshness_cutoff
),
inventory AS (
  SELECT DISTINCT ON (coalesce(nullif(job.fingerprint, ''), job.job_id))
    coalesce(nullif(job.fingerprint, ''), job.job_id) AS unique_key,
    lower(coalesce(job.provider, '')) AS provider,
    lower(coalesce(job.ats_provider, 'unknown')) AS ats_provider,
    job.title,
    job.normalized_title,
    job.selected_apply_url,
    job.validation_status,
    job.validation_checked_at,
    job.applyability_tier,
    coalesce(job.requires_login, false) AS requires_login,
    coalesce(job.requires_account_creation, false) AS requires_account_creation,
    coalesce(job.captcha_detected, false) AS captcha_detected,
    greatest(
      coalesce(job.last_seen_at, '-infinity'::timestamptz),
      coalesce(job.imported_at, '-infinity'::timestamptz),
      coalesce(job.posted_at, '-infinity'::timestamptz)
    ) AS freshness_at
  FROM public.jobs AS job
  CROSS JOIN parameters
  WHERE lower(coalesce(job.country_code, '')) = 'fr'
    AND greatest(
      coalesce(job.last_seen_at, '-infinity'::timestamptz),
      coalesce(job.imported_at, '-infinity'::timestamptz),
      coalesce(job.posted_at, '-infinity'::timestamptz)
    ) >= parameters.freshness_cutoff
    AND greatest(
      coalesce(job.last_seen_at, '-infinity'::timestamptz),
      coalesce(job.imported_at, '-infinity'::timestamptz),
      coalesce(job.posted_at, '-infinity'::timestamptz)
    ) <= parameters.generated_at
  ORDER BY
    coalesce(nullif(job.fingerprint, ''), job.job_id),
    greatest(
      coalesce(job.last_seen_at, '-infinity'::timestamptz),
      coalesce(job.imported_at, '-infinity'::timestamptz),
      coalesce(job.posted_at, '-infinity'::timestamptz)
    ) DESC
),
classified AS (
  SELECT
    inventory.*,
    (
      selected_apply_url IS NOT NULL
      AND btrim(selected_apply_url) <> ''
      AND coalesce(validation_status, '') <> 'invalid'
      AND coalesce(applyability_tier, '') NOT IN ('D', 'E')
      AND NOT requires_login
      AND NOT requires_account_creation
      AND NOT captcha_detected
    ) AS actionable,
    (
      selected_apply_url IS NOT NULL
      AND btrim(selected_apply_url) <> ''
      AND validation_status = 'valid'
      AND applyability_tier IN ('A', 'B')
      AND NOT requires_login
      AND NOT requires_account_creation
      AND NOT captcha_detected
      AND ats_provider NOT IN ('', 'unknown', 'none')
    ) AS static_auto,
    (
      selected_apply_url IS NOT NULL
      AND btrim(selected_apply_url) <> ''
      AND validation_status = 'valid'
      AND applyability_tier IN ('A', 'B')
      AND NOT requires_login
      AND NOT requires_account_creation
      AND NOT captcha_detected
      AND ats_provider IN (
        'greenhouse',
        'smartrecruiters',
        'taleez',
        'teamtailor',
        'jobaffinity'
      )
    ) AS runtime_ready
  FROM inventory
),
bucketed AS (
  SELECT
    classified.*,
    CASE
      WHEN runtime_ready THEN 'runtime_ready'
      WHEN selected_apply_url IS NULL OR btrim(selected_apply_url) = ''
        THEN 'missing_url'
      WHEN coalesce(validation_status, '') = 'invalid'
        OR coalesce(applyability_tier, '') IN ('D', 'E')
        THEN 'expired_or_unavailable'
      WHEN requires_login OR requires_account_creation
        THEN 'account_or_login_required'
      WHEN captcha_detected THEN 'captcha_or_bot_wall'
      WHEN provider IN ('indeed', 'jsearch', 'hellowork', 'wttj')
        AND ats_provider IN ('', 'unknown', 'none')
        THEN 'aggregator_or_discovery_route'
      WHEN ats_provider IN ('', 'unknown', 'none') THEN 'unknown_ats'
      WHEN ats_provider NOT IN (
        'greenhouse',
        'smartrecruiters',
        'taleez',
        'teamtailor',
        'jobaffinity'
      ) THEN 'known_ats_without_runtime_driver'
      WHEN validation_checked_at IS NULL
        OR validation_checked_at < (SELECT generated_at FROM parameters) - interval '7 days'
        THEN 'stale_validation'
      WHEN coalesce(validation_status, '') <> 'valid'
        THEN 'runtime_driver_route_unresolved'
      WHEN coalesce(applyability_tier, '') = 'C'
        THEN 'unsupported_required_fields'
      ELSE 'direct_manual_only'
    END AS route_bucket
  FROM classified
),
failure_counts AS (
  SELECT route_bucket, count(*)::bigint AS count
  FROM bucketed
  WHERE route_bucket <> 'runtime_ready'
  GROUP BY route_bucket
),
provider_counts AS (
  SELECT provider, count(*)::bigint AS count
  FROM bucketed
  WHERE runtime_ready
  GROUP BY provider
),
paid_profiles AS (
  SELECT
    users.user_id,
    CASE
      WHEN jsonb_typeof(profiles.data -> 'target_roles') = 'array'
        THEN profiles.data -> 'target_roles'
      WHEN nullif(btrim(profiles.target_role), '') IS NOT NULL
        THEN jsonb_build_array(profiles.target_role)
      WHEN nullif(btrim(profiles.data ->> 'target_role'), '') IS NOT NULL
        THEN jsonb_build_array(profiles.data ->> 'target_role')
      ELSE '[]'::jsonb
    END AS target_roles
  FROM public.users AS users
  JOIN public.profiles AS profiles USING (user_id)
  WHERE lower(coalesce(users.data #>> '{billing,subscription_status}', ''))
    IN ('active', 'trialing')
),
paid_role_tokens AS (
  SELECT DISTINCT
    paid_profiles.user_id,
    role_token.token
  FROM paid_profiles
  CROSS JOIN LATERAL jsonb_array_elements_text(paid_profiles.target_roles)
    AS target_role(value)
  CROSS JOIN LATERAL regexp_split_to_table(
    lower(target_role.value),
    '[^[:alnum:]+#.-]+'
  ) AS role_token(token)
  WHERE length(role_token.token) >= 3
    AND role_token.token NOT IN (
      'and', 'avec', 'dans', 'des', 'for', 'les', 'pour', 'the'
    )
),
evaluated_paid_users AS (
  SELECT DISTINCT user_id
  FROM paid_role_tokens
),
paid_user_matches AS (
  SELECT DISTINCT
    paid_role_tokens.user_id,
    bucketed.unique_key
  FROM paid_role_tokens
  JOIN bucketed
    ON bucketed.runtime_ready
   AND lower(coalesce(bucketed.normalized_title, bucketed.title, ''))
      LIKE '%' || paid_role_tokens.token || '%'
),
paid_user_counts AS (
  SELECT
    evaluated_paid_users.user_id,
    count(paid_user_matches.unique_key)::bigint AS runtime_ready_jobs
  FROM evaluated_paid_users
  LEFT JOIN paid_user_matches USING (user_id)
  GROUP BY evaluated_paid_users.user_id
),
paid_user_coverage AS (
  SELECT
    count(*)::bigint AS evaluated_paid_users,
    count(*) FILTER (WHERE runtime_ready_jobs = 0)::bigint AS exhausted_paid_users,
    coalesce(
      percentile_disc(0.1) WITHIN GROUP (ORDER BY runtime_ready_jobs),
      0
    )::bigint AS p10,
    coalesce(
      percentile_disc(0.5) WITHIN GROUP (ORDER BY runtime_ready_jobs),
      0
    )::bigint AS p50,
    coalesce(
      percentile_disc(0.9) WITHIN GROUP (ORDER BY runtime_ready_jobs),
      0
    )::bigint AS p90
  FROM paid_user_counts
)
SELECT jsonb_build_object(
  'status', CASE
    WHEN paid_user_coverage.evaluated_paid_users > 0 THEN 'COMPLETE'
    ELSE 'BLOCKED_EXTERNAL'
  END,
  'blockerReason', CASE
    WHEN paid_user_coverage.evaluated_paid_users > 0 THEN NULL
    ELSE 'paid_user_role_cohort_unavailable'
  END,
  'sample', false,
  'generatedAt', parameters.generated_at,
  'freshnessCutoff', parameters.freshness_cutoff,
  'queryVersion', 'g018-route-readiness-v1',
  'layeredFrenchJobs', count(*)::bigint,
  'actionableJobs', count(*) FILTER (WHERE actionable)::bigint,
  'staticAutoApplicable', count(*) FILTER (WHERE static_auto)::bigint,
  'runtimeReadyAutoApplicable', count(*) FILTER (WHERE runtime_ready)::bigint,
  'franceTravailRuntimeReady',
    count(*) FILTER (WHERE runtime_ready AND provider = 'france_travail')::bigint,
  'topProviderRuntimeReady', coalesce((SELECT max(count) FROM provider_counts), 0),
  'failureBuckets',
    jsonb_build_object(
      'missing_url', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'missing_url'), 0),
      'expired_or_unavailable', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'expired_or_unavailable'), 0),
      'account_or_login_required', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'account_or_login_required'), 0),
      'captcha_or_bot_wall', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'captcha_or_bot_wall'), 0),
      'aggregator_or_discovery_route', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'aggregator_or_discovery_route'), 0),
      'unknown_ats', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'unknown_ats'), 0),
      'known_ats_without_runtime_driver', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'known_ats_without_runtime_driver'), 0),
      'runtime_driver_route_unresolved', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'runtime_driver_route_unresolved'), 0),
      'unsupported_required_fields', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'unsupported_required_fields'), 0),
      'missing_user_input', 0,
      'stale_validation', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'stale_validation'), 0),
      'direct_manual_only', coalesce((SELECT count FROM failure_counts WHERE route_bucket = 'direct_manual_only'), 0)
    ),
  'paidUserCoverage', jsonb_build_object(
    'evaluatedPaidUsers', paid_user_coverage.evaluated_paid_users,
    'exhaustedPaidUsers', paid_user_coverage.exhausted_paid_users,
    'p10', paid_user_coverage.p10,
    'p50', paid_user_coverage.p50,
    'p90', paid_user_coverage.p90
  )
)
FROM bucketed
CROSS JOIN parameters
CROSS JOIN paid_user_coverage
GROUP BY
  parameters.generated_at,
  parameters.freshness_cutoff,
  paid_user_coverage.evaluated_paid_users,
  paid_user_coverage.exhausted_paid_users,
  paid_user_coverage.p10,
  paid_user_coverage.p50,
  paid_user_coverage.p90;
