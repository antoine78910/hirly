import type { AnalyticsTimestampQuality } from "@hirly/contracts";
import type { Database } from "./index";

export type MigrationLedgerStatus =
  | "pending"
  | "claimed"
  | "accepted"
  | "observed"
  | "excluded"
  | "quarantined"
  | "uncertain";

export type MigrationIdentityQuality =
  | "identified_at_ingest"
  | "legacy_anonymous_unlinked"
  | "legacy_anonymous_one_to_one"
  | "legacy_anonymous_ambiguous"
  | "unknown";

export interface MigrationLedgerSeed {
  sourceEventId: string;
  sourceCreatedAt: Date;
  canonicalEventName: string | null;
  transformVersion: string;
  payloadHash: string;
  timestampQuality: AnalyticsTimestampQuality;
  identityQuality: MigrationIdentityQuality;
  status: Extract<
    MigrationLedgerStatus,
    "pending" | "excluded" | "quarantined"
  >;
  dispositionReason: string | null;
  transformedPayload: Record<string, unknown> | null;
}

export interface ClaimedMigrationRow {
  runId: string;
  sourceEventId: string;
  sourceCreatedAt: Date;
  canonicalEventName: string;
  payloadHash: string;
  transformedPayload: Record<string, unknown>;
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  attemptCount: number;
}

interface MigrationLedgerRow {
  run_id: string;
  source_event_id: string;
  source_created_at: Date;
  canonical_event_name: string | null;
  payload_hash: string;
  transformed_payload: Record<string, unknown> | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  attempt_count: number;
}

function asClaimed(row: MigrationLedgerRow): ClaimedMigrationRow {
  if (
    !row.canonical_event_name ||
    !row.transformed_payload ||
    !row.lease_owner ||
    !row.lease_token ||
    !row.lease_expires_at
  ) {
    throw new Error("claimed migration row is incomplete");
  }
  return {
    runId: row.run_id,
    sourceEventId: row.source_event_id,
    sourceCreatedAt: row.source_created_at,
    canonicalEventName: row.canonical_event_name,
    payloadHash: row.payload_hash,
    transformedPayload: row.transformed_payload,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: row.attempt_count,
  };
}

export class AnalyticsBackfillRepository {
  constructor(private readonly sql: Database) {}

  async createRun(input: {
    transformVersion: string;
    sourceCutoffAt: Date;
    dryRun: boolean;
    filters?: Record<string, unknown>;
  }): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO public.posthog_migration_runs (
        transform_version, source_cutoff_at, dry_run, filters
      )
      VALUES (
        ${input.transformVersion},
        ${input.sourceCutoffAt},
        ${input.dryRun},
        ${this.sql.json(JSON.parse(JSON.stringify(input.filters ?? {})))}
      )
      RETURNING id
    `;
    if (!row) throw new Error("posthog migration run insert returned no row");
    return row.id;
  }

  async seed(runId: string, rows: MigrationLedgerSeed[]): Promise<void> {
    await this.sql.begin(async (transaction) => {
      for (const row of rows) {
        const changed = await transaction<{ source_event_id: string }[]>`
          INSERT INTO public.posthog_migration_ledger (
            run_id, source_event_id, source_created_at, canonical_event_name,
            transform_version, payload_hash, timestamp_quality, identity_quality,
            status, disposition_reason, transformed_payload
          )
          VALUES (
            ${runId}::uuid, ${row.sourceEventId}, ${row.sourceCreatedAt},
            ${row.canonicalEventName}, ${row.transformVersion}, ${row.payloadHash},
            ${row.timestampQuality}, ${row.identityQuality}, ${row.status},
            ${row.dispositionReason},
            ${row.transformedPayload
              ? transaction.json(JSON.parse(JSON.stringify(row.transformedPayload)))
              : null}
          )
          ON CONFLICT (run_id, source_event_id) DO UPDATE SET
            canonical_event_name = EXCLUDED.canonical_event_name,
            payload_hash = EXCLUDED.payload_hash,
            timestamp_quality = EXCLUDED.timestamp_quality,
            identity_quality = EXCLUDED.identity_quality,
            status = CASE
              WHEN public.posthog_migration_ledger.status = 'pending'
                THEN EXCLUDED.status
              ELSE public.posthog_migration_ledger.status
            END,
            disposition_reason = CASE
              WHEN public.posthog_migration_ledger.status = 'pending'
                THEN EXCLUDED.disposition_reason
              ELSE public.posthog_migration_ledger.disposition_reason
            END,
            transformed_payload = CASE
              WHEN public.posthog_migration_ledger.status = 'pending'
                THEN EXCLUDED.transformed_payload
              ELSE public.posthog_migration_ledger.transformed_payload
            END,
            updated_at = clock_timestamp()
          WHERE public.posthog_migration_ledger.transform_version = EXCLUDED.transform_version
            AND public.posthog_migration_ledger.payload_hash = EXCLUDED.payload_hash
          RETURNING source_event_id
        `;
        if (changed.length === 0) {
          throw new Error(
            `ledger_source_mutation_detected:${row.sourceEventId}`,
          );
        }
      }
    });
  }

  async claim(
    runId: string,
    leaseOwner: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<ClaimedMigrationRow[]> {
    const rows = await this.sql<MigrationLedgerRow[]>`
      SELECT *
      FROM public.claim_posthog_migration_rows(
        ${runId}::uuid, ${leaseOwner}, ${limit}, ${leaseSeconds}
      )
    `;
    return rows.map(asClaimed);
  }

  async markSendStarted(row: ClaimedMigrationRow): Promise<boolean> {
    const [result] = await this.sql<{ ok: boolean }[]>`
      SELECT public.mark_posthog_migration_send_started(
        ${row.runId}::uuid, ${row.sourceEventId}, ${row.leaseOwner},
        ${row.leaseToken}::uuid
      ) AS ok
    `;
    return result?.ok === true;
  }

  async markAccepted(
    row: ClaimedMigrationRow,
    response: Record<string, unknown>,
  ): Promise<boolean> {
    const [result] = await this.sql<{ ok: boolean }[]>`
      SELECT public.accept_posthog_migration_row(
        ${row.runId}::uuid, ${row.sourceEventId}, ${row.leaseOwner},
        ${row.leaseToken}::uuid,
        ${this.sql.json(JSON.parse(JSON.stringify(response)))}
      ) AS ok
    `;
    return result?.ok === true;
  }

  async markUncertain(row: ClaimedMigrationRow, reason: string): Promise<boolean> {
    const [result] = await this.sql<{ source_event_id: string }[]>`
      UPDATE public.posthog_migration_ledger
      SET status = 'uncertain',
          disposition_reason = ${reason},
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE run_id = ${row.runId}::uuid
        AND source_event_id = ${row.sourceEventId}
        AND status = 'claimed'
        AND lease_owner = ${row.leaseOwner}
        AND lease_token = ${row.leaseToken}::uuid
        AND send_started_at IS NOT NULL
      RETURNING source_event_id
    `;
    return result !== undefined;
  }

  async markObserved(
    runId: string,
    sourceEventId: string,
    observation: Record<string, unknown>,
  ): Promise<boolean> {
    const [result] = await this.sql<{ ok: boolean }[]>`
      SELECT public.observe_posthog_migration_row(
        ${runId}::uuid, ${sourceEventId},
        ${this.sql.json(JSON.parse(JSON.stringify(observation)))}
      ) AS ok
    `;
    return result?.ok === true;
  }
}
