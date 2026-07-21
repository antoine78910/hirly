import type { CanonicalJob, Provider, RunView } from "@hirly/contracts";
import type {
  JobProjectionRepository,
  Lease,
  ProviderWorkClaim,
  WorkerRepository,
} from "@hirly/db";
import type { DueSchedule, RuntimeStore } from "./types";

export class PostgresRuntimeStore implements RuntimeStore {
  constructor(
    private readonly repository: WorkerRepository,
  ) {}

  async assertProviderRunnable(provider: Provider): Promise<void> {
    return this.repository.assertProviderRunnable(provider);
  }

  async dueSchedules(limit: number): Promise<DueSchedule[]> {
    return this.repository.listDueSchedules(limit);
  }

  enqueueDueSchedule(
    scheduleId: string,
    nextDueAt: Date,
  ): Promise<string | null> {
    return this.repository.enqueueDueSchedule(scheduleId, nextDueAt);
  }

  enqueue(input: Parameters<WorkerRepository["enqueue"]>[0]): Promise<string> {
    return this.repository.enqueue(input);
  }

  attachCareerSource(runId: string, sourceId: string): Promise<void> {
    return this.repository.attachCareerSource(runId, sourceId);
  }

  async getRun(runId: string): Promise<RunView | null> {
    return this.repository.getRun(runId);
  }

  writeJobsAndComplete(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    jobs: CanonicalJob[],
  ): Promise<boolean> {
    return this.repository.writeJobsAndComplete(lease, providerClaim, jobs);
  }

  getSproutSourceRuntime(
    sourceId: string,
    mode: "canary" | "backfill" | "incremental",
  ) {
    return this.repository.getSproutSourceRuntime(sourceId, mode);
  }

  commitSproutSourcePage(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    commit: Parameters<WorkerRepository["commitSproutSourcePage"]>[2],
  ) {
    return this.repository.commitSproutSourcePage(lease, providerClaim, commit);
  }

  recordSproutIngestionError(
    lease: Lease,
    input: Parameters<WorkerRepository["recordSproutIngestionError"]>[1],
  ) {
    return this.repository.recordSproutIngestionError(lease, input);
  }

  claimProviderWork(lease: Lease, provider: Provider, leaseSeconds: number) {
    return this.repository.claimProviderWork(lease, provider, leaseSeconds);
  }

  heartbeatProviderWork(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
    leaseSeconds: number,
  ) {
    return this.repository.heartbeatProviderWork(
      lease,
      providerClaim,
      leaseSeconds,
    );
  }

  finishProviderWork(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
  ) {
    return this.repository.finishProviderWork(lease, providerClaim);
  }

  releaseProviderWork(
    lease: Lease,
    providerClaim: ProviderWorkClaim,
  ) {
    return this.repository.releaseProviderWork(lease, providerClaim);
  }
}

export class PostgresJobProjectionStore {
  constructor(private readonly repository: JobProjectionRepository) {}

  claim(...args: Parameters<JobProjectionRepository["claim"]>) {
    return this.repository.claim(...args);
  }

  heartbeat(...args: Parameters<JobProjectionRepository["heartbeat"]>) {
    return this.repository.heartbeat(...args);
  }

  loadSource(...args: Parameters<JobProjectionRepository["loadSource"]>) {
    return this.repository.loadSource(...args);
  }

  completeUpsert(...args: Parameters<JobProjectionRepository["completeUpsert"]>) {
    return this.repository.completeUpsert(...args);
  }

  completeRemove(...args: Parameters<JobProjectionRepository["completeRemove"]>) {
    return this.repository.completeRemove(...args);
  }

  finish(...args: Parameters<JobProjectionRepository["finish"]>) {
    return this.repository.finish(...args);
  }

  enqueueReconciliation(
    ...args: Parameters<JobProjectionRepository["enqueueReconciliation"]>
  ) {
    return this.repository.enqueueReconciliation(...args);
  }
}
