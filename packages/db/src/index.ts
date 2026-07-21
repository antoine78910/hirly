import {
  careerSourceCandidateRegistrationSchema,
  careerSourceCandidateSchema,
  runViewSchema,
  sourcePageCommitResultSchema,
  sourcePageCommitSchema,
  type CanonicalJob,
  type CareerSourceCandidate,
  type CareerSourceCandidateRegistration,
  type EnqueueRun,
  type Provider,
  type RunView,
  type SourcePageCommit,
  type SourcePageCommitResult,
} from "@hirly/contracts";
import postgres, { type Sql } from "postgres";

export * from "./analytics-backfill";

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

export interface SproutSourceRuntimeConfiguration {
  sourceId: string;
  policyId: string;
  endpoint: string;
  credentialRef: string;
  approvedPageSize: number;
  checkpoint: Record<string, unknown>;
  policyEvidenceRef: string;
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
      city: job.city ?? null,
      region: job.region ?? null,
      country_code: job.countryCode,
      remote: job.remote ?? null,
      salary_min: job.salaryMin ?? null,
      salary_max: job.salaryMax ?? null,
      currency: job.currency ?? null,
      posted_at: job.postedAt ?? null,
      imported_at: job.importedAt ?? null,
      last_seen_at: job.lastSeenAt ?? null,
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

  async commitSproutSourcePage(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    commit: SourcePageCommit,
  ): Promise<SourcePageCommitResult> {
    if (providerClaim.provider !== "sprout") {
      throw new Error("Sprout source commits require a Sprout ownership claim");
    }
    const input = sourcePageCommitSchema.parse(commit);
    const entries = input.entries.map((entry) => ({
      canonical: {
        job_id: entry.canonical.jobId,
        provider: entry.canonical.provider,
        external_id: entry.canonical.externalId,
        title: entry.canonical.title,
        normalized_title: entry.canonical.normalizedTitle,
        company: entry.canonical.company,
        normalized_company: entry.canonical.normalizedCompany,
        location: entry.canonical.location,
        city: entry.canonical.city ?? null,
        region: entry.canonical.region ?? null,
        country_code: entry.canonical.countryCode,
        remote: entry.canonical.remote ?? null,
        salary_min: entry.canonical.salaryMin ?? null,
        salary_max: entry.canonical.salaryMax ?? null,
        currency: entry.canonical.currency ?? null,
        posted_at: entry.canonical.postedAt ?? null,
        imported_at: entry.canonical.importedAt ?? null,
        last_seen_at: entry.canonical.lastSeenAt ?? null,
        selected_apply_url: entry.canonical.selectedApplyUrl,
        validation_status: entry.canonical.validationStatus,
        validation_reason: entry.canonical.validationReason,
        validation_checked_at: entry.canonical.validationCheckedAt,
        applyability_tier: entry.canonical.applyabilityTier,
        applyability_score: entry.canonical.applyabilityScore,
        apply_fulfillment_status: entry.canonical.applyFulfillmentStatus,
        apply_url_provider: entry.canonical.applyUrlProvider,
        ats_provider: entry.canonical.atsProvider,
        requires_login: entry.canonical.requiresLogin,
        requires_account_creation: entry.canonical.requiresAccountCreation,
        captcha_detected: entry.canonical.captchaDetected,
        manual_fulfillment_ready: entry.canonical.manualFulfillmentReady,
        auto_apply_supported: entry.canonical.autoApplySupported,
        rejection_reason: entry.canonical.rejectionReason,
        fingerprint: entry.canonical.fingerprint,
        data: entry.canonical.data,
      },
      content_hash: entry.contentHash,
      fetched_at: entry.fetchedAt,
      source_document: entry.sourceDocument,
      canonical_source_url: entry.canonicalSourceUrl,
      canonical_apply_url: entry.canonicalApplyUrl,
      ats_posting_id: entry.atsPostingId,
      published_at: entry.publishedAt,
      expires_at: entry.expiresAt,
      lifecycle_state: entry.lifecycleState,
      attribution: entry.attribution,
      policy_id: entry.policyId,
    }));
    const [row] = await this.sql<{ commit_sprout_source_page: unknown }[]>`
      SELECT worker_private.commit_sprout_source_page(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${providerClaim.claimId}::uuid,
        ${input.sourceId}::uuid,
        ${input.countryCode},
        ${input.mode},
        ${this.sql.json(asJson(input.checkpointIn))},
        ${this.sql.json(asJson(input.checkpointOut))},
        ${input.complete},
        ${this.sql.json(asJson(entries))}
      )
    `;
    if (!row) throw new Error("commit_sprout_source_page returned no row");
    return sourcePageCommitResultSchema.parse(row.commit_sprout_source_page);
  }

  async getSproutSourceRuntime(
    sourceId: string,
    mode: "backfill" | "incremental",
  ): Promise<SproutSourceRuntimeConfiguration | null> {
    const [row] = await this.sql<{
      source_id: string;
      policy_id: string;
      endpoint: string;
      credential_ref: string;
      approved_page_size: number;
      checkpoint: Record<string, unknown>;
      evidence_reference: string;
    }[]>`
      SELECT
        source.id AS source_id,
        source.policy_id,
        source.base_url AS endpoint,
        source.credential_ref,
        source.approved_page_size,
        source.checkpoint,
        policy.evidence_reference
      FROM public.career_sources AS source
      JOIN public.source_policy AS policy
        ON policy.id = source.policy_id AND policy.provider = source.provider
      WHERE source.id = ${sourceId}::uuid
        AND source.provider = 'sprout'
        AND source.base_url IS NOT NULL
        AND source.credential_ref IS NOT NULL
        AND source.approved_page_size IS NOT NULL
        AND source.checkpoint->>'pageSize' = source.approved_page_size::text
        AND policy.evidence_reference IS NOT NULL
        AND worker_private.career_source_runnable(source.id, 'FR', ${mode})
    `;
    if (!row) return null;
    return {
      sourceId: row.source_id,
      policyId: row.policy_id,
      endpoint: row.endpoint,
      credentialRef: row.credential_ref,
      approvedPageSize: row.approved_page_size,
      checkpoint: row.checkpoint,
      policyEvidenceRef: row.evidence_reference,
    };
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

  async heartbeatProviderWork(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    leaseSeconds: number,
  ): Promise<boolean> {
    const [row] = await this.sql<{ heartbeat_provider_work: boolean }[]>`
      SELECT worker_private.heartbeat_provider_work(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${providerClaim.claimId}::uuid,
        ${leaseSeconds}
      )
    `;
    return row?.heartbeat_provider_work === true;
  }

  async finishProviderWork(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
  ): Promise<boolean> {
    const [row] = await this.sql<{ finish_provider_work: boolean }[]>`
      SELECT worker_private.finish_provider_work(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${providerClaim.claimId}::uuid,
        'succeeded',
        NULL,
        NULL,
        NULL
      )
    `;
    return row?.finish_provider_work === true;
  }

  async releaseProviderWork(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
  ): Promise<boolean> {
    const [row] = await this.sql<{ release_provider_work: boolean }[]>`
      SELECT worker_private.release_provider_work(
        ${lease.taskId}::uuid,
        ${lease.leaseToken}::uuid,
        ${lease.claimGeneration.toString()}::bigint,
        ${lease.leaseOwner},
        ${providerClaim.claimId}::uuid
      )
    `;
    return row?.release_provider_work === true;
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

  async registerCareerSourceCandidate(
    candidate: CareerSourceCandidateRegistration,
  ): Promise<CareerSourceCandidate> {
    const input = careerSourceCandidateRegistrationSchema.parse(candidate);
    const [row] = await this.sql<
      {
        id: string;
        provider: string;
        source_key: string;
        tenant_key: string;
        company_id: string | null;
        company_name: string | null;
        country_codes: string[];
        base_url: string;
        access_type: CareerSourceCandidate["accessType"];
        policy_id: string | null;
        sync_frequency_seconds: number | null;
        checkpoint: Record<string, unknown>;
        last_attempt_at: Date | null;
        last_success_at: Date | null;
        last_complete_run_id: string | null;
        consecutive_failures: number;
        enabled: boolean;
        transport_enabled: boolean;
        incremental_enabled: boolean;
        backfill_enabled: boolean;
        discovery_state: CareerSourceCandidate["discoveryState"];
      }[]
    >`
      SELECT
        source.id,
        source.provider,
        source.source_key,
        source.tenant_key,
        source.company_id,
        source.company_name,
        source.country_codes,
        source.base_url,
        source.access_type,
        source.policy_id,
        extract(epoch FROM source.sync_frequency)::integer
          AS sync_frequency_seconds,
        source.checkpoint,
        source.last_attempt_at,
        source.last_success_at,
        source.last_complete_run_id,
        source.consecutive_failures,
        source.enabled,
        source.transport_enabled,
        source.incremental_enabled,
        source.backfill_enabled,
        source.discovery_state
      FROM worker_private.register_career_source_candidate(
        ${input.provider},
        ${input.sourceKey},
        ${input.tenantKey},
        ${input.companyId},
        ${input.companyName},
        ${input.countryCodes},
        ${input.baseUrl},
        ${input.accessType},
        ${input.syncFrequencySeconds},
        ${this.sql.json(asJson(input.checkpoint))}
      ) AS source
    `;
    if (!row) throw new Error("register_career_source_candidate returned no row");
    return careerSourceCandidateSchema.parse({
      id: row.id,
      provider: row.provider,
      sourceKey: row.source_key,
      tenantKey: row.tenant_key,
      companyId: row.company_id,
      companyName: row.company_name,
      countryCodes: row.country_codes,
      baseUrl: row.base_url,
      accessType: row.access_type,
      policyId: row.policy_id,
      syncFrequencySeconds: row.sync_frequency_seconds,
      checkpoint: row.checkpoint,
      lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
      lastSuccessAt: row.last_success_at?.toISOString() ?? null,
      lastCompleteRunId: row.last_complete_run_id,
      consecutiveFailures: row.consecutive_failures,
      enabled: row.enabled,
      transportEnabled: row.transport_enabled,
      incrementalEnabled: row.incremental_enabled,
      backfillEnabled: row.backfill_enabled,
      discoveryState: row.discovery_state,
    });
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
