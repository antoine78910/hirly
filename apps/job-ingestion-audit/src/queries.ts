export const JOB_SUPPLY_OBSERVABILITY_QUERIES = {
  sourceInventory: `
    SELECT
      provider,
      count(*)::bigint AS rows,
      count(DISTINCT external_id)::bigint AS provider_unique,
      count(*) FILTER (WHERE last_seen_at >= $1::timestamptz)::bigint AS fresh,
      count(*) FILTER (
        WHERE selected_apply_url IS NOT NULL
          AND validation_status = 'valid'
          AND apply_fulfillment_status = 'manual_ready'
      )::bigint AS actionable,
      count(*) FILTER (
        WHERE ats_provider IS NOT NULL AND ats_provider <> 'unknown'
      )::bigint AS route_known
    FROM public.jobs
    GROUP BY provider
    ORDER BY actionable DESC, provider
  `,
  atsHostCensus: `
    SELECT
      lower(regexp_replace(
        split_part(split_part(selected_apply_url, '://', 2), '/', 1),
        '^www\\.', ''
      )) AS host,
      coalesce(ats_provider, 'unknown') AS ats_provider,
      count(*)::bigint AS jobs,
      count(DISTINCT normalized_company)::bigint AS companies,
      count(*) FILTER (WHERE country_code = 'fr')::bigint AS france_jobs,
      count(*) FILTER (WHERE validation_status = 'valid')::bigint AS valid_jobs
    FROM public.jobs
    WHERE selected_apply_url IS NOT NULL
    GROUP BY 1, 2
    ORDER BY france_jobs DESC, jobs DESC, host
  `,
  routeQuality: `
    WITH inventory AS (
      SELECT *
      FROM public.jobs
      WHERE country_code = 'fr' AND last_seen_at >= $1::timestamptz
    )
    SELECT
      count(*)::bigint AS inventory_rows,
      count(*) FILTER (WHERE selected_apply_url IS NOT NULL)::numeric
        / nullif(count(*), 0) AS canonical_apply_url_rate,
      count(*) FILTER (
        WHERE coalesce(ats_provider, 'unknown') <> 'unknown'
           OR coalesce(apply_url_provider, 'unknown') <> 'unknown'
      )::numeric / nullif(count(*), 0) AS known_route_rate,
      count(*) FILTER (
        WHERE validation_status = 'invalid'
           OR apply_fulfillment_status IN ('blocked_expired', 'blocked_unavailable')
           OR rejection_reason IN ('stale_not_seen_recently', 'job_closed', 'job_expired')
      )::numeric / nullif(count(*), 0) AS expired_or_unavailable_rate,
      1 - count(DISTINCT coalesce(fingerprint, job_id))::numeric
        / nullif(count(*), 0) AS estimated_duplicate_rate
    FROM inventory
  `,
  providerConcentration: `
    WITH actionable AS (
      SELECT provider, count(*)::bigint AS jobs
      FROM public.jobs
      WHERE country_code = 'fr'
        AND last_seen_at >= $1::timestamptz
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
    ORDER BY jobs DESC, provider
  `,
  paidUserCoverage: `
    SELECT
      percentile_cont(0.1) WITHIN GROUP (ORDER BY unseen_actionable_total) AS p10,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY unseen_actionable_total) AS median,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY unseen_actionable_total) AS p90,
      avg((unseen_actionable_total = 0)::integer)::numeric(8, 4) AS feed_exhaustion_rate
    FROM public.paid_user_inventory_snapshots
    WHERE coverage_run_id = $1::uuid
      AND freshness_window_days = $2::integer
  `,
  runCompleteness: `
    SELECT
      coalesce(provider, source_id) AS source,
      count(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
      count(*) FILTER (WHERE status = 'partially_succeeded')::bigint AS partial,
      count(*) FILTER (WHERE status = 'failed')::bigint AS failed,
      count(*) FILTER (WHERE completeness_state = 'complete_snapshot')::bigint AS complete,
      count(*)::bigint AS runs
    FROM public.worker_runs
    WHERE requested_at >= $1::timestamptz
    GROUP BY 1
    ORDER BY 1
  `,
  franceTravailPartitions: `
    SELECT
      partition.partition_id,
      partition.status,
      partition.source_reported_total,
      partition.pages_requested,
      partition.pages_completed,
      partition.retries,
      partition.counters,
      partition.terminal_error_code,
      partition.terminal_error_reason
    FROM public.worker_run_partitions AS partition
    JOIN public.worker_runs AS run ON run.id = partition.run_id
    WHERE coalesce(run.provider, run.source_id) = 'france_travail'
      AND run.run_mode = 'census'
      AND run.normalized_scope->>'manifest_digest' = $1
    ORDER BY partition.partition_id
  `,
  topology: `
    SELECT jsonb_build_object(
      'enabled_career_sources',
        count(*) FILTER (WHERE enabled),
      'production_eligible_sources',
        count(*) FILTER (WHERE production_eligible),
      'provider_registry_is_writer_authority',
        true
    ) AS topology
    FROM public.career_source_activation_status
  `,
} as const;

export type JobSupplyObservabilityQuery = keyof typeof JOB_SUPPLY_OBSERVABILITY_QUERIES;

export interface AuditQueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]>;
}

export async function runJobSupplyObservabilityQueries(
  executor: AuditQueryExecutor,
  input: {
    freshnessCutoff: string;
    coverageRunId: string;
    freshnessWindowDays: 1 | 7 | 30;
    manifestDigest: string;
  },
): Promise<Record<JobSupplyObservabilityQuery, Record<string, unknown>[]>> {
  const execute = <T extends Record<string, unknown>>(
    name: JobSupplyObservabilityQuery,
    parameters: readonly unknown[] = [],
  ) => executor.query<T>(JOB_SUPPLY_OBSERVABILITY_QUERIES[name], parameters);
  const [
    sourceInventory,
    atsHostCensus,
    routeQuality,
    providerConcentration,
    paidUserCoverage,
    runCompleteness,
    franceTravailPartitions,
    topology,
  ] = await Promise.all([
    execute("sourceInventory", [input.freshnessCutoff]),
    execute("atsHostCensus"),
    execute("routeQuality", [input.freshnessCutoff]),
    execute("providerConcentration", [input.freshnessCutoff]),
    execute("paidUserCoverage", [input.coverageRunId, input.freshnessWindowDays]),
    execute("runCompleteness", [input.freshnessCutoff]),
    execute("franceTravailPartitions", [input.manifestDigest]),
    execute("topology"),
  ]);
  return {
    sourceInventory,
    atsHostCensus,
    routeQuality,
    providerConcentration,
    paidUserCoverage,
    runCompleteness,
    franceTravailPartitions,
    topology,
  };
}

export function assertReadOnlyObservabilityQueries(): string[] {
  return Object.entries(JOB_SUPPLY_OBSERVABILITY_QUERIES).flatMap(([name, query]) => {
    const normalized = query.replace(/--.*$/gm, " ").trim().toLowerCase();
    if (!/^(select|with)\b/.test(normalized)) return [`${name}:not_read_only`];
    if (
      /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke)\b/.test(normalized)
    ) {
      return [`${name}:mutation_detected`];
    }
    return [];
  });
}
