import type {
  AnalyticsBackfillRepository,
  ClaimedMigrationRow,
  MigrationLedgerSeed,
} from "@hirly/db";
import {
  ANALYTICS_BACKFILL_TRANSFORM_VERSION,
  afterCheckpoint,
  orderLegacyRows,
  stablePayloadHash,
  transformLegacyAnalyticsRow,
  type BackfillCheckpoint,
  type BackfillDisposition,
  type LegacyAnalyticsRow,
} from "./transform";

export interface BackfillManifest {
  schemaVersion: "hirly.analytics-backfill-manifest.v1";
  transformVersion: typeof ANALYTICS_BACKFILL_TRANSFORM_VERSION;
  sourceCutoffAt: string;
  checkpoint: BackfillCheckpoint | null;
  counts: Record<BackfillDisposition["status"], number>;
  timestampQuality: Record<string, number>;
  identityQuality: Record<string, number>;
  reasonCounts: Record<string, number>;
  digest: string;
}

export interface PostHogTransport {
  send(row: ClaimedMigrationRow): Promise<{
    outcome: "accepted" | "uncertain";
    metadata: Record<string, unknown>;
  }>;
}

export interface RunBackfillOptions {
  rows: LegacyAnalyticsRow[];
  sourceCutoffAt: string;
  checkpoint?: BackfillCheckpoint | null;
  batchSize?: number;
  rateLimitPerSecond?: number;
  dryRun: boolean;
  runId?: string;
  leaseOwner?: string;
  repository?: AnalyticsBackfillRepository;
  transport?: PostHogTransport;
  stopRequested?: () => boolean | Promise<boolean>;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildBackfillManifest(
  dispositions: BackfillDisposition[],
  sourceCutoffAt: string,
): BackfillManifest {
  const counts = { pending: 0, excluded: 0, quarantined: 0 };
  const timestampQuality: Record<string, number> = {};
  const identityQuality: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  for (const disposition of dispositions) {
    counts[disposition.status] += 1;
    increment(timestampQuality, disposition.timestampQuality);
    increment(identityQuality, disposition.identityQuality);
    if (disposition.reason) increment(reasonCounts, disposition.reason);
  }
  const last = dispositions.at(-1);
  const checkpoint = last
    ? { createdAt: last.sourceCreatedAt, eventId: last.sourceEventId }
    : null;
  const unsigned = {
    schemaVersion: "hirly.analytics-backfill-manifest.v1" as const,
    transformVersion: ANALYTICS_BACKFILL_TRANSFORM_VERSION,
    sourceCutoffAt,
    checkpoint,
    counts,
    timestampQuality,
    identityQuality,
    reasonCounts,
  };
  return { ...unsigned, digest: stablePayloadHash(unsigned) };
}

function asSeed(disposition: BackfillDisposition): MigrationLedgerSeed {
  return {
    sourceEventId: disposition.sourceEventId,
    sourceCreatedAt: new Date(disposition.sourceCreatedAt),
    canonicalEventName: disposition.canonicalEventName,
    transformVersion: disposition.transformVersion,
    payloadHash: disposition.payloadHash,
    timestampQuality: disposition.timestampQuality,
    identityQuality: disposition.identityQuality,
    status: disposition.status,
    dispositionReason: disposition.reason,
    transformedPayload: disposition.payload
      ? { ...disposition.payload }
      : null,
  };
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function runBackfill(
  options: RunBackfillOptions,
): Promise<BackfillManifest> {
  const cutoff = new Date(options.sourceCutoffAt);
  if (!Number.isFinite(cutoff.valueOf())) throw new Error("invalid_source_cutoff");
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("invalid_batch_size");
  }
  const rateLimitPerSecond = options.rateLimitPerSecond ?? 10;
  if (
    !Number.isFinite(rateLimitPerSecond) ||
    rateLimitPerSecond <= 0 ||
    rateLimitPerSecond > 1_000
  ) {
    throw new Error("invalid_rate_limit");
  }
  const rows = orderLegacyRows(options.rows)
    .filter((row) => afterCheckpoint(row, options.checkpoint ?? null))
    .filter((row) => {
      const sourceCreatedAt = new Date(row.createdAt).valueOf();
      return (
        !Number.isFinite(sourceCreatedAt) ||
        sourceCreatedAt <= cutoff.valueOf()
      );
    });
  const dispositions = rows.map(transformLegacyAnalyticsRow);
  const manifest = buildBackfillManifest(dispositions, cutoff.toISOString());
  if (options.dryRun) return manifest;
  if (
    !options.repository ||
    !options.transport ||
    !options.runId ||
    !options.leaseOwner
  ) {
    throw new Error("execute_mode_requires_repository_transport_run_and_owner");
  }

  await options.repository.seed(options.runId, dispositions.map(asSeed));
  const delayMs = 1000 / rateLimitPerSecond;
  while (!(await options.stopRequested?.())) {
    const claimed = await options.repository.claim(
      options.runId,
      options.leaseOwner,
      batchSize,
      300,
    );
    if (claimed.length === 0) break;
    for (const row of claimed) {
      if (await options.stopRequested?.()) return manifest;
      if (!(await options.repository.markSendStarted(row))) {
        throw new Error(`lost_claim_before_send:${row.sourceEventId}`);
      }
      try {
        const result = await options.transport.send(row);
        if (result.outcome === "accepted") {
          if (!(await options.repository.markAccepted(row, result.metadata))) {
            throw new Error(`accept_fence_failed:${row.sourceEventId}`);
          }
        } else {
          await options.repository.markUncertain(
            row,
            "transport_outcome_uncertain_requires_reconciliation",
          );
          return manifest;
        }
      } catch (error) {
        await options.repository.markUncertain(
          row,
          `transport_exception:${error instanceof Error ? error.message : "unknown"}`,
        );
        return manifest;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  return manifest;
}
