\set ON_ERROR_STOP on

-- G008 operator measurements. Run with a read-only database role against the
-- physical database that owns public.jobs and the worker ledger:
--
-- psql "$JOBS_DATABASE_URL" \
--   -v freshness_cutoff="2026-07-13T00:00:00Z" \
--   -v window_start="2026-07-01T00:00:00Z" \
--   -v window_end="2026-07-15T00:00:00Z" \
--   -v coverage_run_id="00000000-0000-0000-0000-000000000000" \
--   -f scripts/job-supply-observability.sql
--
-- This script never mutates jobs, writer ownership, schedules, policies, or
-- source enablement.

BEGIN TRANSACTION READ ONLY;

-- 0. Applied topology and the single-writer/source-policy safety state.
SELECT
  current_database() AS database_name,
  to_regclass('public.jobs') AS jobs_table,
  to_regclass('public.worker_runs') AS worker_runs_table,
  to_regclass('public.worker_run_partitions') AS worker_run_partitions_table,
  to_regclass('public.paid_user_inventory_snapshots') AS coverage_snapshots_table,
  to_regclass('public.paid_user_source_contributions') AS source_contributions_table;

SELECT
  registry.provider,
  registry.enabled AS provider_enabled,
  registry.writer_runtime,
  registry.authorization_status,
  source.source_key,
  source.collection_enabled,
  policy.policy_status,
  policy.production_enabled
FROM public.provider_registry AS registry
LEFT JOIN public.career_sources AS source ON source.provider = registry.provider
LEFT JOIN public.source_policies AS policy ON policy.source_id = source.id
ORDER BY registry.provider, source.source_key;

-- 1. Inventory, freshness, actionability, route coverage, and duplicate proxy.
SELECT
  provider,
  count(*)::bigint AS inventory_rows,
  count(DISTINCT external_id)::bigint AS provider_unique,
  count(*) FILTER (WHERE last_seen_at >= :'freshness_cutoff'::timestamptz)::bigint AS fresh_rows,
  count(*) FILTER (
    WHERE selected_apply_url IS NOT NULL
      AND validation_status = 'valid'
      AND apply_fulfillment_status NOT IN ('blocked_expired', 'blocked_unavailable')
  )::bigint AS actionable_rows,
  count(*) FILTER (
    WHERE coalesce(ats_provider, 'unknown') <> 'unknown'
       OR coalesce(apply_url_provider, 'unknown') <> 'unknown'
  )::bigint AS route_known_rows,
  (
    1 - count(DISTINCT coalesce(fingerprint, job_id))::numeric
      / nullif(count(*), 0)
  )::numeric(8, 6) AS estimated_duplicate_rate
FROM public.jobs
GROUP BY provider
ORDER BY actionable_rows DESC, provider;

-- 2. Apply-host and ATS census used to rank connector candidates.
SELECT
  lower(regexp_replace(
    split_part(split_part(selected_apply_url, '://', 2), '/', 1),
    '^www\.',
    ''
  )) AS apply_host,
  coalesce(ats_provider, 'unknown') AS ats_provider,
  count(*)::bigint AS jobs,
  count(DISTINCT normalized_company)::bigint AS companies,
  count(*) FILTER (WHERE country_code = 'fr')::bigint AS france_jobs,
  count(*) FILTER (WHERE validation_status = 'valid')::bigint AS valid_jobs
FROM public.jobs
WHERE selected_apply_url IS NOT NULL
GROUP BY 1, 2
ORDER BY france_jobs DESC, jobs DESC, apply_host;

-- 3. Paid-user P10/P50/P90, median, and feed exhaustion from PR1 aggregates.
-- No profile text, CV text, or raw user identifier is read here.
SELECT
  coverage_run_id,
  freshness_window_days,
  count(*)::bigint AS paid_users,
  percentile_cont(0.1) WITHIN GROUP (ORDER BY unseen_actionable_total) AS p10,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY unseen_actionable_total) AS median,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY unseen_actionable_total) AS p90,
  avg((unseen_actionable_total = 0)::integer)::numeric(8, 6) AS exhaustion_rate,
  avg(route_known_total::numeric / nullif(relevant_total, 0))::numeric(8, 6)
    AS mean_route_known_rate,
  avg(direct_employer_total::numeric / nullif(relevant_total, 0))::numeric(8, 6)
    AS mean_direct_employer_rate
FROM public.paid_user_inventory_snapshots
WHERE coverage_run_id = :'coverage_run_id'::uuid
GROUP BY coverage_run_id, freshness_window_days
ORDER BY freshness_window_days;

-- 4. Actionable inventory concentration. A connector cannot pass solely by
-- increasing total rows while paid-user coverage remains flat.
WITH actionable AS (
  SELECT provider, count(*)::bigint AS jobs
  FROM public.jobs
  WHERE country_code = 'fr'
    AND last_seen_at >= :'freshness_cutoff'::timestamptz
    AND selected_apply_url IS NOT NULL
    AND validation_status = 'valid'
    AND apply_fulfillment_status NOT IN ('blocked_expired', 'blocked_unavailable')
  GROUP BY provider
)
SELECT
  provider,
  jobs,
  jobs::numeric / nullif(sum(jobs) OVER (), 0) AS actionable_inventory_share
FROM actionable
ORDER BY jobs DESC, provider;

-- 5. Run/partition completeness and request-cost evidence.
SELECT
  run.id,
  coalesce(run.source_id, run.provider) AS source,
  run.status,
  run.completeness_state,
  run.requested_at,
  run.finished_at,
  run.pages_requested,
  run.pages_completed,
  run.retries,
  run.source_reported_total,
  run.raw_records,
  run.normalized_records,
  run.actionable_records,
  run.request_cost_minor,
  run.request_cost_currency,
  count(partition.id)::integer AS partition_count,
  count(*) FILTER (
    WHERE partition.status IN ('completed_with_results', 'completed_zero_results')
  )::integer AS complete_partitions,
  count(*) FILTER (WHERE partition.status = 'failed')::integer AS failed_partitions,
  count(*) FILTER (WHERE partition.status = 'blocked')::integer AS blocked_partitions
FROM public.worker_runs AS run
LEFT JOIN public.worker_run_partitions AS partition ON partition.run_id = run.id
WHERE run.requested_at >= :'window_start'::timestamptz
  AND run.requested_at < :'window_end'::timestamptz
GROUP BY run.id
ORDER BY run.requested_at DESC;

-- 6. France Travail census reconciliation. A terminal complete decision input
-- requires every partition to reconcile source total through actionable count.
SELECT
  run.id AS run_id,
  run.status AS run_status,
  run.completeness_state,
  count(*)::integer AS partition_count,
  count(*) FILTER (
    WHERE partition.status IN ('completed_with_results', 'completed_zero_results')
  )::integer AS complete_partitions,
  count(*) FILTER (
    WHERE partition.status IN ('failed', 'blocked')
  )::integer AS noncomplete_partitions,
  sum(partition.source_reported_total)::bigint AS source_reported_total,
  sum(coalesce((partition.counters->>'raw_records')::bigint, 0)) AS fetched_records,
  sum(coalesce((partition.counters->>'normalized_records')::bigint, 0)) AS normalized_records,
  sum(coalesce((partition.counters->>'rejected_records')::bigint, 0)) AS rejected_records,
  sum(coalesce((partition.counters->>'actionable_records')::bigint, 0)) AS actionable_records,
  bool_or(coalesce((partition.counters->>'cap_hit')::boolean, false)) AS any_cap_hit,
  bool_and(
    coalesce((partition.counters->>'raw_records')::bigint, 0)
      = coalesce((partition.counters->>'normalized_records')::bigint, 0)
      + coalesce((partition.counters->>'rejected_records')::bigint, 0)
  ) AS stage_accounting_reconciled
FROM public.worker_runs AS run
JOIN public.worker_run_partitions AS partition ON partition.run_id = run.id
WHERE coalesce(run.source_id, run.provider) = 'france_travail'
  AND run.requested_at >= :'window_start'::timestamptz
  AND run.requested_at < :'window_end'::timestamptz
GROUP BY run.id
ORDER BY run.requested_at DESC;

-- 7. Cost per incremental fresh, relevant, actionable canonical group.
WITH cost AS (
  SELECT
    source_id,
    request_cost_currency,
    sum(request_cost_minor)::bigint AS cost_minor
  FROM public.worker_runs
  WHERE requested_at >= :'window_start'::timestamptz
    AND requested_at < :'window_end'::timestamptz
  GROUP BY source_id, request_cost_currency
), contribution AS (
  SELECT
    source_id,
    count(DISTINCT canonical_group_id)::bigint AS groups,
    sum(affected_paid_users)::bigint AS affected_paid_users
  FROM public.paid_user_source_contributions
  WHERE coverage_run_id = :'coverage_run_id'::uuid
    AND incremental
    AND fresh
    AND relevant
    AND actionable
  GROUP BY source_id
)
SELECT
  contribution.source_id,
  cost.request_cost_currency,
  contribution.groups,
  contribution.affected_paid_users,
  cost.cost_minor,
  cost.cost_minor::numeric / nullif(contribution.groups, 0)
    AS cost_minor_per_incremental_group
FROM contribution
LEFT JOIN cost USING (source_id)
ORDER BY contribution.affected_paid_users DESC, contribution.source_id;

COMMIT;
