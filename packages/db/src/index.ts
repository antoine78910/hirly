import {
  runViewSchema,
  type CanonicalJob,
  type EnqueueRun,
  type Provider,
  type RunView,
} from "@hirly/contracts";
import postgres, { type Sql } from "postgres";

export type Database = Sql<Record<string, postgres.PostgresType>>;

export interface Lease {
  taskId: string;
  leaseToken: string;
  claimGeneration: bigint;
  leaseOwner: string;
}

export interface ClaimedTask extends Lease {
  runId: string;
  taskKey: string;
  taskType: string;
  provider: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  leaseUntil: Date;
}

export interface ProviderWorkClaim {
  claimId: string;
  provider: Provider;
  runtime: "typescript";
  ownershipEpoch: bigint;
  expiresAt: Date;
}

export interface DueSchedule {
  id: string;
  cronExpression: string;
  timezone: string;
  nextDueAt: Date;
  maxCatchUp: number;
  databaseNow: Date;
}

interface WorkerTaskRow {
  id: string;
  run_id: string;
  task_key: string;
  task_type: string;
  provider: string | null;
  payload: Record<string, unknown>;
  lease_token: string;
  claim_generation: string;
  lease_owner: string;
  attempts: number;
  max_attempts: number;
  lease_until: Date;
}

function asJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

export function createDatabase(
  url: string,
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
): Database {
  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ...options,
  });
}

export class WorkerRepository {
  constructor(private readonly sql: Database) {}

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async ping(): Promise<boolean> {
    const [row] = await this.sql<{ ok: number }[]>`SELECT 1 AS ok`;
    return row?.ok === 1;
  }

  async assertProviderRunnable(provider: Provider): Promise<void> {
    const [row] = await this.sql<{ provider_runnable: boolean }[]>`
      SELECT worker_private.provider_runnable(${provider})
    `;
    if (row?.provider_runnable !== true) {
      throw new Error("authorization_blocked");
    }
  }

  async listDueSchedules(limit: number): Promise<DueSchedule[]> {
    const rows = await this.sql<
      {
        id: string;
        cron_expression: string;
        timezone: string;
        next_due_at: Date;
        max_catch_up: number;
        database_now: Date;
      }[]
    >`
      SELECT *
      FROM worker_private.list_due_schedules(${limit})
    `;
    return rows.map((row) => ({
      id: row.id,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      nextDueAt: row.next_due_at,
      maxCatchUp: row.max_catch_up,
      databaseNow: row.database_now,
    }));
  }

  async getRun(runId: string): Promise<RunView | null> {
    const [row] = await this.sql<
      {
        id: string;
        kind: string;
        provider: string | null;
        trigger_source: string;
        status: string;
        requested_at: Date;
        started_at: Date | null;
        finished_at: Date | null;
        summary: Record<string, unknown>;
        error_code: string | null;
      }[]
    >`
      SELECT *
      FROM worker_private.get_run(${runId}::uuid)
    `;
    if (!row) return null;
    return runViewSchema.parse({
      id: row.id,
      kind: row.kind,
      provider: row.provider,
      triggerSource: row.trigger_source,
      status: row.status,
      requestedAt: row.requested_at.toISOString(),
      startedAt: row.started_at?.toISOString() ?? null,
      finishedAt: row.finished_at?.toISOString() ?? null,
      summary: row.summary,
      errorCode: row.error_code,
    });
  }

  async enqueue(input: EnqueueRun): Promise<string> {
    return this.sql.begin(async (transaction) => {
      let runId: string | undefined;
      for (const [index, task] of input.tasks.entries()) {
        const [run] = await transaction<{ id: string }[]>`
          SELECT id
          FROM worker_private.enqueue_run(
            ${input.kind},
            ${input.provider},
            ${input.idempotencyKey},
            ${input.triggerSource},
            ${task.taskKey},
            ${task.taskType},
            ${transaction.json(asJson(task.payload))},
            ${task.maxAttempts},
            ${task.availableAt ? new Date(task.availableAt) : new Date()},
            ${input.scheduleId},
            ${input.scheduledFor ? new Date(input.scheduledFor) : null}
          )
        `;
        if (!run) throw new Error("enqueue_run returned no row");
        if (index > 0 && runId !== run.id) {
          throw new Error("enqueue_run returned inconsistent run identity");
        }
        runId = run.id;
      }
      if (!runId) throw new Error("run must contain at least one task");
      return runId;
    });
  }

  async claim(
    leaseOwner: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<ClaimedTask[]> {
    const rows = await this.sql<WorkerTaskRow[]>`
      SELECT *
      FROM worker_private.claim_tasks(${leaseOwner}, ${limit}, ${leaseSeconds})
    `;
    return rows.map((row) => ({
      taskId: row.id,
      runId: row.run_id,
      taskKey: row.task_key,
      taskType: row.task_type,
      provider: row.provider,
      payload: row.payload,
      leaseToken: row.lease_token,
      claimGeneration: BigInt(row.claim_generation),
      leaseOwner: row.lease_owner,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      leaseUntil: row.lease_until,
    }));
  }

  async heartbeat(lease: Lease, leaseSeconds: number): Promise<boolean> {
    const [row] = await this.sql<{ heartbeat_task: boolean }[]>`
      SELECT worker_private.heartbeat_task(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${leaseSeconds}
      )
    `;
    return row?.heartbeat_task === true;
  }

  async finish(
    lease: Lease,
    outcome: "succeeded" | "retryable" | "failed" | "cancelled",
    options: {
      errorCode?: string;
      errorMessage?: string;
      retryAt?: Date;
    } = {},
  ): Promise<boolean> {
    const [row] = await this.sql<{ finish_task: boolean }[]>`
      SELECT worker_private.finish_task(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${outcome},
        ${options.errorCode ?? null},
        ${options.errorMessage ?? null},
        ${options.retryAt ?? null}
      )
    `;
    return row?.finish_task === true;
  }

  async writeJobAndComplete(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    job: CanonicalJob,
  ): Promise<boolean> {
    return this.writeJobsAndComplete(lease, providerClaim, [job]);
  }

  async writeJobsAndComplete(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    jobs: CanonicalJob[],
  ): Promise<boolean> {
    const databaseJobs = jobs.map((job) => ({
      job_id: job.jobId,
      provider: job.provider,
      external_id: job.externalId,
      title: job.title,
      normalized_title: job.normalizedTitle,
      company: job.company,
      normalized_company: job.normalizedCompany,
      location: job.location,
      country_code: job.countryCode,
      selected_apply_url: job.selectedApplyUrl,
      validation_status: job.validationStatus,
      validation_reason: job.validationReason,
      validation_checked_at: job.validationCheckedAt,
      applyability_tier: job.applyabilityTier,
      applyability_score: job.applyabilityScore,
      apply_fulfillment_status: job.applyFulfillmentStatus,
      apply_url_provider: job.applyUrlProvider,
      ats_provider: job.atsProvider,
      requires_login: job.requiresLogin,
      requires_account_creation: job.requiresAccountCreation,
      captcha_detected: job.captchaDetected,
      manual_fulfillment_ready: job.manualFulfillmentReady,
      auto_apply_supported: job.autoApplySupported,
      rejection_reason: job.rejectionReason,
      fingerprint: job.fingerprint,
      data: job.data,
    }));
    const [row] = await this.sql<{ write_jobs_and_complete: boolean }[]>`
      SELECT worker_private.write_jobs_and_complete(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${providerClaim.claimId}::uuid,
        ${this.sql.json(asJson(databaseJobs))}
      )
    `;
    return row?.write_jobs_and_complete === true;
  }

  async claimProviderWork(
    lease: Lease,
    provider: Provider,
    leaseSeconds: number,
  ): Promise<ProviderWorkClaim> {
    const [row] = await this.sql<
      {
        claim_id: string;
        provider: Provider;
        runtime: "typescript";
        ownership_epoch: string;
        expires_at: Date;
      }[]
    >`
      SELECT *
      FROM worker_private.claim_provider_work(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${provider},
        ${leaseSeconds}
      )
    `;
    if (!row) throw new Error("authorization_blocked");
    return {
      claimId: row.claim_id,
      provider: row.provider,
      runtime: row.runtime,
      ownershipEpoch: BigInt(row.ownership_epoch),
      expiresAt: row.expires_at,
    };
  }

  async setProviderAuthorization(input: {
    provider: string;
    status: "unverified" | "authorized" | "blocked";
    evidenceRef: string | null;
    reviewedAt: Date;
  }): Promise<void> {
    await this.sql`
      SELECT worker_private.set_provider_authorization(
        ${input.provider}, ${input.status}, ${input.evidenceRef}, ${input.reviewedAt}
      )
    `;
  }

  async setProviderWriter(
    provider: string,
    writer: "none" | "python" | "typescript",
  ): Promise<void> {
    await this.sql`
      SELECT worker_private.set_provider_writer(${provider}, ${writer})
    `;
  }

  async setProviderEnabled(provider: string, enabled: boolean): Promise<void> {
    await this.sql`
      SELECT worker_private.set_provider_enabled(${provider}, ${enabled})
    `;
  }

  async setScheduleEnabled(
    scheduleId: string,
    enabled: boolean,
    nextDueAt: Date | null = null,
  ): Promise<void> {
    await this.sql`
      SELECT worker_private.set_schedule_enabled(
        ${scheduleId}, ${enabled}, ${nextDueAt}
      )
    `;
  }

  async upsertSchedule(input: {
    id: string;
    taskType: "provider.fetch_page" | "inventory.maintenance";
    provider: string | null;
    cronExpression: string;
    timezone: string;
    payload: Record<string, unknown>;
    nextDueAt: Date;
    maxCatchUp?: number;
  }): Promise<void> {
    await this.sql`
      SELECT worker_private.upsert_schedule(
        ${input.id},
        ${input.taskType},
        ${input.provider},
        ${input.cronExpression},
        ${input.timezone},
        ${this.sql.json(asJson(input.payload))},
        ${input.nextDueAt},
        ${input.maxCatchUp ?? 1}
      )
    `;
  }

  async enqueueDueSchedule(
    scheduleId: string,
    nextDueAt: Date,
  ): Promise<string | null> {
    const [row] = await this.sql<{ id: string }[]>`
      SELECT id
      FROM worker_private.enqueue_due_schedule(${scheduleId}, ${nextDueAt})
    `;
    return row?.id ?? null;
  }
}
