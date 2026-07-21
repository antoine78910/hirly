import type { CanonicalJob, Provider, RunView } from "@hirly/contracts";
import type { Lease, ProviderWorkClaim, WorkerRepository } from "@hirly/db";
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
    mode: "backfill" | "incremental",
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
