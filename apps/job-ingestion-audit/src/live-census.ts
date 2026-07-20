import type { Database } from "@hirly/db";
import {
  buildFranceTravailCensusManifest,
  type FranceTravailCensusManifest,
  type FranceTravailPartitionEvidence,
} from "./observability";

interface PartitionRow {
  run_id: string;
  partition_id: string;
  status: FranceTravailPartitionEvidence["status"];
  source_reported_total: number | null;
  counters: Record<string, unknown>;
}

export interface LiveJobSupplyReport {
  schemaVersion: 1;
  generatedAt: string;
  census: FranceTravailCensusManifest;
  sourceBaseline: Record<string, unknown>[];
  atsHostBaseline: Record<string, unknown>[];
  paidUserBaseline: Record<string, unknown>[];
  sourceEnablement: Array<{
    provider: string;
    provider_enabled: boolean;
    writer_runtime: string;
    source_key: string;
    collection_enabled: boolean;
    production_enabled: boolean;
  }>;
}

function counter(counters: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (!Object.hasOwn(counters, key)) continue;
    const value = counters[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    return 0;
  }
  return 0;
}

export async function collectLiveJobSupplyReport(
  sql: Database,
  generatedAt = new Date().toISOString(),
  persistManifest = false,
): Promise<LiveJobSupplyReport> {
  const partitions = await sql<PartitionRow[]>`
    SELECT
      partition.run_id,
      partition.partition_id,
      partition.status,
      partition.source_reported_total,
      partition.counters
    FROM public.worker_run_partitions AS partition
    JOIN public.worker_runs AS run ON run.id = partition.run_id
    WHERE coalesce(run.source_id, run.provider) = 'france_travail'
      AND run.run_mode = 'census'
      AND run.status IN ('succeeded', 'partially_succeeded', 'failed')
    ORDER BY run.requested_at, partition.partition_id
  `;
  const census = buildFranceTravailCensusManifest(
    partitions.map((row) => ({
      runId: row.run_id,
      partitionId: row.partition_id,
      status: row.status,
      sourceReportedTotal: row.source_reported_total,
      fetchedRecords: counter(row.counters, "raw_records", "fetched_records"),
      normalizedRecords: counter(row.counters, "normalized_records"),
      rejectedRecords: counter(row.counters, "rejected_records"),
      actionableRecords: counter(row.counters, "actionable_records"),
      capHit: row.counters.cap_hit === true,
    })),
    generatedAt,
  );
  if (persistManifest) {
    await sql.begin(async (transaction) => {
      const [inserted] = await transaction<{ id: string }[]>`
        INSERT INTO public.france_travail_census_manifests (
          schema_version, manifest_digest, generated_at, source_run_ids,
          partition_count, terminal_state, source_reported_total, fetched_records,
          normalized_records, rejected_records, actionable_records, manifest
        )
        VALUES (
          ${census.schemaVersion}, ${census.digest}, ${new Date(census.generatedAt)},
          ${transaction.array(census.sourceRunIds)}::uuid[], ${census.partitionCount},
          ${census.terminalState}, ${census.sourceReportedTotal}, ${census.fetchedRecords},
          ${census.normalizedRecords}, ${census.rejectedRecords},
          ${census.actionableRecords},
          ${transaction.json(JSON.parse(JSON.stringify(census)))}
        )
        ON CONFLICT (manifest_digest) DO NOTHING
        RETURNING id
      `;
      const [existing] = inserted ? [] : await transaction<{ id: string }[]>`
        SELECT id
        FROM public.france_travail_census_manifests
        WHERE manifest_digest = ${census.digest}
      `;
      const manifest = inserted ?? existing;
      if (!manifest) throw new Error("france_travail_manifest_insert_failed");
      for (const runId of census.sourceRunIds) {
        await transaction`
          INSERT INTO public.france_travail_census_manifest_runs (manifest_id, run_id)
          VALUES (${manifest.id}, ${runId}::uuid)
          ON CONFLICT (manifest_id, run_id) DO NOTHING
        `;
      }
    });
  }
  const [sourceBaseline, atsHostBaseline, paidUserBaseline, sourceEnablement] = await Promise.all([
    sql<Record<string, unknown>[]>`SELECT * FROM public.job_supply_source_baseline ORDER BY provider`,
    sql<Record<string, unknown>[]>`
      SELECT * FROM public.job_supply_ats_host_baseline
      ORDER BY france_jobs DESC, jobs DESC, apply_host
    `,
    sql<Record<string, unknown>[]>`
      SELECT * FROM public.paid_user_inventory_baseline
      ORDER BY coverage_run_id, freshness_window_days
    `,
    sql<LiveJobSupplyReport["sourceEnablement"]>`
      SELECT
        registry.provider,
        registry.enabled AS provider_enabled,
        registry.writer_runtime,
        source.source_key,
        source.collection_enabled,
        policy.production_enabled
      FROM public.career_sources AS source
      JOIN public.provider_registry AS registry ON registry.provider = source.provider
      JOIN public.source_policies AS policy ON policy.source_id = source.id
      ORDER BY registry.provider, source.source_key
    `,
  ]);
  return {
    schemaVersion: 1,
    generatedAt,
    census,
    sourceBaseline,
    atsHostBaseline,
    paidUserBaseline,
    sourceEnablement,
  };
}
