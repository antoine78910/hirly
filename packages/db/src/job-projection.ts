import type { JobSearchDocumentPersistenceRow } from "@hirly/contracts";
import type postgres from "postgres";
import type { Database } from "./index";

export type JobProjectionTaskKind =
  | "job.document.project"
  | "projection.reconcile";

export interface JobProjectionLease {
  taskId: string;
  taskKind: JobProjectionTaskKind;
  entityId: string;
  entityVersion: bigint;
  idempotencyKey: string;
  leaseOwner: string;
  leaseToken: string;
  claimGeneration: bigint;
  sourceDigest: string | null;
  leaseUntil: Date;
  attempts: number;
  maxAttempts: number;
}

export interface JobProjectionSourceRecord {
  authoritativeVersion: string;
  canonicalGroupId: string;
  preferredJobId: string;
  groupStatus: "active" | "split" | "superseded" | "archived";
  title: string;
  normalizedTitle: string | null;
  company: string;
  location: string;
  countryCode: string | null;
  remote: boolean | null;
  latitude: number | null;
  longitude: number | null;
  publishedAt: string | null;
  importedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  lifecycleState: string | null;
  validationStatus: string;
  applyabilityTier: string;
  applyFulfillmentStatus: string;
  autoApplySupported: boolean;
  manualFulfillmentReady: boolean;
  sourceEligible: boolean;
  policyEligible: boolean;
  data: Record<string, unknown>;
}

interface ProjectionTaskRow {
  task_id: string;
  task_kind: JobProjectionTaskKind;
  entity_id: string;
  entity_version: string;
  idempotency_key: string;
  lease_owner: string;
  lease_token: string;
  claim_generation: string;
  source_digest: string | null;
  lease_until: Date;
  attempts: number;
  max_attempts: number;
}

function leaseFromRow(row: ProjectionTaskRow): JobProjectionLease {
  return {
    taskId: row.task_id,
    taskKind: row.task_kind,
    entityId: row.entity_id,
    entityVersion: BigInt(row.entity_version),
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    claimGeneration: BigInt(row.claim_generation),
    sourceDigest: row.source_digest,
    leaseUntil: row.lease_until,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

function serialized(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

export class JobProjectionRepository {
  constructor(private readonly sql: Database) {}

  async claim(
    leaseOwner: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<JobProjectionLease[]> {
    const rows = await this.sql<ProjectionTaskRow[]>`
      SELECT *
      FROM worker_private.claim_job_projection_tasks(
        ${leaseOwner}, ${limit}, ${leaseSeconds}
      )
    `;
    return rows.map(leaseFromRow);
  }

  async heartbeat(
    lease: JobProjectionLease,
    leaseSeconds: number,
  ): Promise<boolean> {
    const [row] = await this.sql<{ heartbeat_job_projection_task: boolean }[]>`
      SELECT worker_private.heartbeat_job_projection_task(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${leaseSeconds}
      )
    `;
    return row?.heartbeat_job_projection_task === true;
  }

  async loadSource(
    lease: JobProjectionLease,
  ): Promise<JobProjectionSourceRecord | null> {
    const [row] = await this.sql<{ source: JobProjectionSourceRecord | null }[]>`
      SELECT worker_private.read_job_projection_source(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner}
      ) AS source
    `;
    return row?.source ?? null;
  }

  async completeUpsert(
    lease: JobProjectionLease,
    document: JobSearchDocumentPersistenceRow,
    sourceContentHash: string,
    durationMs: number,
  ): Promise<boolean> {
    const [row] = await this.sql<{ complete_job_projection_upsert: boolean }[]>`
      SELECT worker_private.complete_job_projection_upsert(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${this.sql.json(serialized(document))},
        ${sourceContentHash},
        ${Math.max(0, Math.round(durationMs))}
      )
    `;
    return row?.complete_job_projection_upsert === true;
  }

  async completeRemove(
    lease: JobProjectionLease,
    canonicalGroupId: string,
    authoritativeVersion: string,
    durationMs: number,
  ): Promise<boolean> {
    const [row] = await this.sql<{ complete_job_projection_remove: boolean }[]>`
      SELECT worker_private.complete_job_projection_remove(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${canonicalGroupId}::uuid,
        ${authoritativeVersion}::bigint,
        ${Math.max(0, Math.round(durationMs))}
      )
    `;
    return row?.complete_job_projection_remove === true;
  }

  async finish(
    lease: JobProjectionLease,
    outcome: "succeeded" | "retryable" | "failed",
    options: {
      errorCode?: string;
      errorMessage?: string;
      retryAt?: Date;
      durationMs?: number;
    } = {},
  ): Promise<boolean> {
    const [row] = await this.sql<{ finish_job_projection_task: boolean }[]>`
      SELECT worker_private.finish_job_projection_task(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${outcome},
        ${options.errorCode ?? null},
        ${options.errorMessage ?? null},
        ${options.retryAt ?? null},
        ${Math.max(0, Math.round(options.durationMs ?? 0))}
      )
    `;
    return row?.finish_job_projection_task === true;
  }

  async enqueueReconciliation(limit: number): Promise<number> {
    const [row] = await this.sql<{ enqueue_job_projection_reconciliation: number }[]>`
      SELECT worker_private.enqueue_job_projection_reconciliation(${limit})
    `;
    return row?.enqueue_job_projection_reconciliation ?? 0;
  }
}
