\set ON_ERROR_STOP on

-- G016 read-only aggregate measurement input.
--
-- Required psql variables:
--   generated_at      Fixed ISO timestamptz for reproducible evidence
--   freshness_cutoff  ISO timestamptz, normally now() - 30 days
--   coverage_run_id   paid-cohort coverage worker run UUID
--   trial_run_ids     comma-separated source trial run UUIDs
--
-- The only returned column is aggregate JSON. Job IDs, external IDs, candidate
-- documents, source payloads and hashed user IDs are used only inside the
-- database for classification and are never emitted.
WITH
parameters AS (
  SELECT
    :'generated_at'::timestamptz AS generated_at,
    :'freshness_cutoff'::timestamptz AS freshness_cutoff,
    :'coverage_run_id'::uuid AS coverage_run_id,
    regexp_split_to_array(:'trial_run_ids', '\s*,\s*')::uuid[] AS trial_run_ids
),
trial_run_evidence AS (
  SELECT
    cardinality(parameters.trial_run_ids) AS requested_run_count,
    count(DISTINCT requested.run_id)::integer AS distinct_requested_run_count,
    count(DISTINCT run.id)::integer AS persisted_run_count,
    count(DISTINCT terminal.run_id)::integer AS terminal_run_count,
    coalesce(bool_and(terminal.result->>'status' = 'completed'), false)
      AS all_terminal_completed,
    coalesce(bool_and(
      (terminal.result->>'finishedAt')::timestamptz
        <= parameters.generated_at
    ), false) AS all_terminal_finished_by_generation
  FROM parameters
  LEFT JOIN LATERAL unnest(parameters.trial_run_ids) AS requested(run_id)
    ON true
  LEFT JOIN public.source_trial_runs AS run
    ON run.id = requested.run_id
  LEFT JOIN public.source_trial_scorecards AS terminal
    ON terminal.run_id = run.id
    AND terminal.scorecard_key = 'trial-result'
  GROUP BY parameters.trial_run_ids, parameters.generated_at
),
measurement_gate AS (
  SELECT
    (
      evidence.requested_run_count > 0
      AND evidence.distinct_requested_run_count = evidence.requested_run_count
      AND evidence.persisted_run_count = evidence.requested_run_count
      AND evidence.terminal_run_count = evidence.requested_run_count
      AND evidence.all_terminal_completed
      AND evidence.all_terminal_finished_by_generation
      AND parameters.generated_at >= parameters.freshness_cutoff
      AND EXISTS (
        SELECT 1
        FROM public.worker_runs AS coverage
        WHERE coverage.id = parameters.coverage_run_id
          AND coverage.status = 'succeeded'
          AND coverage.finished_at IS NOT NULL
          AND coverage.finished_at <= parameters.generated_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_trial_runs AS requested_run
        WHERE requested_run.id = ANY(parameters.trial_run_ids)
          AND NOT EXISTS (
            SELECT 1
            FROM public.paid_user_source_contributions AS contribution
            WHERE contribution.coverage_run_id = parameters.coverage_run_id
              AND contribution.source_id = requested_run.source_id
          )
      )
    ) AS trial_runs_complete
  FROM parameters
  CROSS JOIN trial_run_evidence AS evidence
),
inventory_rows AS (
  SELECT
    jobs.job_id,
    lower(coalesce(jobs.provider, 'unknown')) AS provider,
    jobs.external_id,
    nullif(lower(btrim(coalesce(jobs.canonical_apply_url, jobs.selected_apply_url))), '') AS canonical_url,
    CASE
      WHEN nullif(lower(btrim(jobs.ats_provider)), '') IS NOT NULL
        AND nullif(btrim(jobs.ats_job_id), '') IS NOT NULL
      THEN lower(btrim(jobs.ats_provider)) || ':' || btrim(jobs.ats_job_id)
      ELSE NULL
    END AS ats_identity,
    nullif(btrim(jobs.fingerprint), '') AS fingerprint,
    greatest(
      coalesce(jobs.last_seen_at, '-infinity'::timestamptz),
      coalesce(jobs.imported_at, '-infinity'::timestamptz),
      coalesce(jobs.posted_at, '-infinity'::timestamptz)
    ) AS freshness_at,
    (
      jobs.selected_apply_url IS NOT NULL
      AND btrim(jobs.selected_apply_url) <> ''
      AND jobs.validation_status = 'valid'
      AND jobs.applyability_tier IN ('A', 'B')
      AND NOT coalesce(jobs.requires_login, false)
      AND NOT coalesce(jobs.requires_account_creation, false)
      AND NOT coalesce(jobs.captcha_detected, false)
      AND (
        jobs.auto_apply_supported IS true
        OR lower(coalesce(jobs.ats_provider, jobs.provider, '')) IN (
          'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'taleez'
        )
      )
    ) AS auto_applicable,
    coalesce(
      'group:' || jobs.canonical_group_id::text,
      'fingerprint:' || nullif(btrim(jobs.fingerprint), ''),
      'url:' || nullif(lower(btrim(coalesce(jobs.canonical_apply_url, jobs.selected_apply_url))), ''),
      'ats:' || CASE
        WHEN nullif(lower(btrim(jobs.ats_provider)), '') IS NOT NULL
          AND nullif(btrim(jobs.ats_job_id), '') IS NOT NULL
        THEN lower(btrim(jobs.ats_provider)) || ':' || btrim(jobs.ats_job_id)
        ELSE NULL
      END,
      'occurrence:' || lower(coalesce(jobs.provider, 'unknown'))
        || ':' || nullif(btrim(jobs.external_id), ''),
      'job:' || jobs.job_id
    ) AS layered_key
  FROM public.jobs AS jobs
),
inventory_groups AS (
  SELECT
    inventory.layered_key,
    bool_or(inventory.freshness_at >= parameters.freshness_cutoff) AS fresh_30d,
    bool_or(inventory.auto_applicable) AS auto_applicable,
    bool_or(inventory.provider = 'france_travail') AS france_travail,
    bool_or(
      inventory.provider = 'france_travail' AND inventory.auto_applicable
    ) AS france_travail_auto_applicable
  FROM inventory_rows AS inventory
  CROSS JOIN parameters
  GROUP BY inventory.layered_key
),
baseline AS (
  SELECT
    count(*)::bigint AS layered_unique_jobs,
    count(*) FILTER (WHERE fresh_30d)::bigint AS fresh_30d_unique_jobs,
    count(*) FILTER (WHERE auto_applicable)::bigint AS auto_applicable_unique_jobs,
    count(*) FILTER (WHERE france_travail)::bigint AS france_travail_unique_jobs,
    count(*) FILTER (
      WHERE france_travail_auto_applicable
    )::bigint AS france_travail_auto_applicable_jobs
  FROM inventory_groups
),
trial_candidates AS (
  SELECT
    candidate.run_id,
    run.source_id,
    lower(run.provider) AS provider,
    run.tenant_key AS tenant,
    candidate.candidate_key,
    candidate.content_hash,
    nullif(candidate.candidate->>'externalId', '') AS external_id,
    nullif(lower(btrim(candidate.candidate->>'selectedApplyUrl')), '') AS canonical_url,
    CASE
      WHEN nullif(lower(btrim(candidate.candidate->>'atsProvider')), '') IS NOT NULL
        AND nullif(
          btrim(coalesce(
            candidate.candidate#>>'{data,atsPostingId}',
            candidate.candidate#>>'{data,ats_job_id}'
          )),
          ''
        ) IS NOT NULL
      THEN lower(btrim(candidate.candidate->>'atsProvider')) || ':' || btrim(
        coalesce(
          candidate.candidate#>>'{data,atsPostingId}',
          candidate.candidate#>>'{data,ats_job_id}'
        )
      )
      ELSE NULL
    END AS ats_identity,
    nullif(btrim(candidate.candidate->>'fingerprint'), '') AS fingerprint,
    (
      nullif(candidate.candidate->>'selectedApplyUrl', '') IS NOT NULL
      AND candidate.candidate->>'validationStatus' = 'valid'
      AND candidate.candidate->>'applyabilityTier' IN ('A', 'B')
      AND candidate.candidate->>'requiresLogin' = 'false'
      AND candidate.candidate->>'requiresAccountCreation' = 'false'
      AND candidate.candidate->>'captchaDetected' = 'false'
      AND (
        candidate.candidate->>'autoApplySupported' = 'true'
        OR lower(coalesce(candidate.candidate->>'atsProvider', run.provider)) IN (
          'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'taleez'
        )
      )
    ) AS auto_applicable,
    row_number() OVER (
      PARTITION BY lower(run.provider), candidate.candidate->>'externalId'
      ORDER BY candidate.run_id, candidate.candidate_key, candidate.content_hash
    ) AS exact_rank,
    row_number() OVER (
      PARTITION BY nullif(lower(btrim(candidate.candidate->>'selectedApplyUrl')), '')
      ORDER BY candidate.run_id, candidate.candidate_key, candidate.content_hash
    ) AS canonical_url_rank,
    row_number() OVER (
      PARTITION BY
        lower(btrim(candidate.candidate->>'atsProvider')),
        coalesce(
          candidate.candidate#>>'{data,atsPostingId}',
          candidate.candidate#>>'{data,ats_job_id}'
        )
      ORDER BY candidate.run_id, candidate.candidate_key, candidate.content_hash
    ) AS ats_identity_rank,
    row_number() OVER (
      PARTITION BY nullif(btrim(candidate.candidate->>'fingerprint'), '')
      ORDER BY candidate.run_id, candidate.candidate_key, candidate.content_hash
    ) AS fingerprint_rank
  FROM public.source_trial_candidates AS candidate
  JOIN public.source_trial_runs AS run ON run.id = candidate.run_id
  JOIN public.source_trial_scorecards AS terminal
    ON terminal.run_id = run.id
    AND terminal.scorecard_key = 'trial-result'
    AND terminal.result->>'status' = 'completed'
  CROSS JOIN parameters
  WHERE candidate.run_id = ANY(parameters.trial_run_ids)
),
classified_candidates AS (
  SELECT
    trial.run_id,
    trial.source_id,
    trial.provider,
    trial.tenant,
    trial.auto_applicable,
    CASE
      WHEN trial.external_id IS NULL
        OR trial.exact_rank > 1
        OR EXISTS (
          SELECT 1
          FROM inventory_rows AS inventory
          WHERE inventory.provider = trial.provider
            AND inventory.external_id = trial.external_id
        )
      THEN 'exact_occurrence'
      WHEN trial.canonical_url IS NOT NULL AND (
        trial.canonical_url_rank > 1
        OR EXISTS (
          SELECT 1
          FROM inventory_rows AS inventory
          WHERE inventory.canonical_url = trial.canonical_url
        )
      )
      THEN 'canonical_url'
      WHEN trial.ats_identity IS NOT NULL AND (
        trial.ats_identity_rank > 1
        OR EXISTS (
          SELECT 1
          FROM inventory_rows AS inventory
          WHERE inventory.ats_identity = trial.ats_identity
        )
      )
      THEN 'ats_identity'
      WHEN trial.fingerprint IS NULL
        OR trial.fingerprint_rank > 1
        OR EXISTS (
          SELECT 1
          FROM inventory_rows AS inventory
          WHERE inventory.fingerprint = trial.fingerprint
        )
      THEN 'fingerprint'
      ELSE 'incremental'
    END AS dedup_layer
  FROM trial_candidates AS trial
),
candidate_aggregates AS (
  SELECT
    candidate.source_id,
    candidate.provider,
    candidate.tenant,
    count(*)::bigint AS observed_candidates,
    count(*) FILTER (
      WHERE candidate.dedup_layer = 'exact_occurrence'
    )::bigint AS exact_occurrence_duplicates,
    count(*) FILTER (
      WHERE candidate.dedup_layer = 'canonical_url'
    )::bigint AS canonical_url_duplicates,
    count(*) FILTER (
      WHERE candidate.dedup_layer = 'ats_identity'
    )::bigint AS ats_identity_duplicates,
    count(*) FILTER (
      WHERE candidate.dedup_layer = 'fingerprint'
    )::bigint AS fingerprint_duplicates,
    count(*) FILTER (
      WHERE candidate.dedup_layer = 'incremental'
    )::bigint AS incremental_net_new,
    count(*) FILTER (
      WHERE candidate.dedup_layer = 'incremental'
        AND candidate.auto_applicable
    )::bigint AS incremental_auto_applicable
  FROM classified_candidates AS candidate
  GROUP BY candidate.source_id, candidate.provider, candidate.tenant
),
paid_cohort_aggregates AS (
  SELECT
    contribution.source_id,
    count(*) FILTER (
      WHERE contribution.incremental
        AND contribution.fresh
        AND contribution.relevant
        AND contribution.actionable
    )::bigint AS incremental_fresh_relevant_actionable,
    coalesce(sum(contribution.affected_paid_users) FILTER (
      WHERE contribution.incremental
        AND contribution.fresh
        AND contribution.relevant
        AND contribution.actionable
    ), 0)::bigint AS paid_user_job_matches
  FROM public.paid_user_source_contributions AS contribution
  CROSS JOIN parameters
  WHERE contribution.coverage_run_id = parameters.coverage_run_id
  GROUP BY contribution.source_id
),
source_aggregates AS (
  SELECT
    candidate.provider,
    candidate.tenant,
    candidate.observed_candidates,
    candidate.exact_occurrence_duplicates,
    candidate.canonical_url_duplicates,
    candidate.ats_identity_duplicates,
    candidate.fingerprint_duplicates,
    candidate.incremental_net_new,
    coalesce(
      cohort.incremental_fresh_relevant_actionable,
      0
    ) AS incremental_fresh_relevant_actionable,
    candidate.incremental_auto_applicable,
    coalesce(cohort.paid_user_job_matches, 0) AS paid_user_job_matches
  FROM candidate_aggregates AS candidate
  LEFT JOIN paid_cohort_aggregates AS cohort
    ON cohort.source_id = candidate.source_id
),
source_rollup AS (
  SELECT
    source.provider,
    source.tenant,
    sum(source.observed_candidates)::bigint AS observed_candidates,
    sum(source.exact_occurrence_duplicates)::bigint
      AS exact_occurrence_duplicates,
    sum(source.canonical_url_duplicates)::bigint AS canonical_url_duplicates,
    sum(source.ats_identity_duplicates)::bigint AS ats_identity_duplicates,
    sum(source.fingerprint_duplicates)::bigint AS fingerprint_duplicates,
    sum(source.incremental_net_new)::bigint AS incremental_net_new,
    sum(source.incremental_fresh_relevant_actionable)::bigint
      AS incremental_fresh_relevant_actionable,
    sum(source.incremental_auto_applicable)::bigint
      AS incremental_auto_applicable,
    sum(source.paid_user_job_matches)::bigint AS paid_user_job_matches
  FROM source_aggregates AS source
  GROUP BY source.provider, source.tenant
)
SELECT jsonb_build_object(
  'status', CASE
    WHEN measurement_gate.trial_runs_complete
    THEN 'COMPLETE'
    ELSE 'BLOCKED_EXTERNAL'
  END,
  'blockerReason', CASE
    WHEN measurement_gate.trial_runs_complete
    THEN NULL
    ELSE 'trial or paid-cohort evidence is missing, duplicate, nonterminal, or incomplete'
  END,
  'sample', false,
  'generatedAt', parameters.generated_at,
  'freshnessCutoff', parameters.freshness_cutoff,
  'coverageRunId', parameters.coverage_run_id,
  'trialRunIds', to_jsonb(parameters.trial_run_ids),
  'baseline', jsonb_build_object(
    'layeredUniqueJobs', baseline.layered_unique_jobs,
    'fresh30dUniqueJobs', baseline.fresh_30d_unique_jobs,
    'autoApplicableUniqueJobs', baseline.auto_applicable_unique_jobs,
    'franceTravailUniqueJobs', baseline.france_travail_unique_jobs,
    'franceTravailAutoApplicableJobs',
      baseline.france_travail_auto_applicable_jobs
  ),
  'sources', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'provider', source.provider,
      'tenant', source.tenant,
      'observedCandidates', source.observed_candidates,
      'exactOccurrenceDuplicates', source.exact_occurrence_duplicates,
      'canonicalUrlDuplicates', source.canonical_url_duplicates,
      'atsIdentityDuplicates', source.ats_identity_duplicates,
      'fingerprintDuplicates', source.fingerprint_duplicates,
      'incrementalNetNew', source.incremental_net_new,
      'incrementalFreshRelevantActionable',
        source.incremental_fresh_relevant_actionable,
      'incrementalAutoApplicable', source.incremental_auto_applicable,
      'paidUserJobMatches', source.paid_user_job_matches
    ) ORDER BY source.provider, source.tenant)
    FROM source_rollup AS source
  ), '[]'::jsonb)
) AS measurement_input
FROM baseline
CROSS JOIN parameters
CROSS JOIN measurement_gate;
