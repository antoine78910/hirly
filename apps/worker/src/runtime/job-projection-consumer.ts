import {
  projectJobSearchDocument,
  type JobProjectionResult,
  type JobProjectionSource,
} from "@hirly/matching";
import type {
  JobProjectionLease,
  JobProjectionRepository,
} from "@hirly/db";

export type JobProjectionStore = Pick<
  JobProjectionRepository,
  | "claim"
  | "heartbeat"
  | "loadSource"
  | "completeUpsert"
  | "completeRemove"
  | "finish"
  | "enqueueReconciliation"
>;

export interface JobProjectionConsumerOptions {
  enabled: boolean;
  reconciliationEnabled: boolean;
  instanceId: string;
  concurrency: number;
  batchSize: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  pollMs: number;
  reconciliationBatchSize: number;
}

type Project = (
  source: JobProjectionSource,
  projectedAt: Date,
) => Promise<JobProjectionResult>;

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export class JobProjectionConsumer {
  private readonly controller = new AbortController();
  private readonly taskControllers = new Set<AbortController>();
  private readonly active = new Set<Promise<void>>();
  private runPromise: Promise<void> | undefined;

  constructor(
    private readonly store: JobProjectionStore,
    private readonly options: JobProjectionConsumerOptions,
    private readonly project: Project = projectJobSearchDocument,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (!this.options.enabled || this.runPromise) return;
    this.runPromise = this.run();
  }

  private async run(): Promise<void> {
    while (!this.controller.signal.aborted) {
      if (this.options.reconciliationEnabled) {
        try {
          await this.store.enqueueReconciliation(
            this.options.reconciliationBatchSize,
          );
        } catch {
          // A failed reconciliation scan must not bypass the durable task loop.
        }
      }
      const capacity = Math.max(0, this.options.concurrency - this.active.size);
      if (capacity === 0) {
        await wait(this.options.pollMs, this.controller.signal);
        continue;
      }
      let tasks: JobProjectionLease[] = [];
      try {
        tasks = await this.store.claim(
          this.options.instanceId,
          Math.min(capacity, this.options.batchSize),
          this.options.leaseSeconds,
        );
      } catch {
        await wait(this.options.pollMs, this.controller.signal);
        continue;
      }
      if (tasks.length === 0) {
        await wait(this.options.pollMs, this.controller.signal);
        continue;
      }
      for (const task of tasks) {
        const execution = this.execute(task).finally(() =>
          this.active.delete(execution),
        );
        this.active.add(execution);
      }
    }
  }

  private async execute(task: JobProjectionLease): Promise<void> {
    const startedAt = performance.now();
    if (task.taskKind === "projection.reconcile") {
      try {
        await this.store.enqueueReconciliation(
          this.options.reconciliationBatchSize,
        );
        const current = await this.store.finish(task, "succeeded", {
          durationMs: performance.now() - startedAt,
        });
        if (!current) throw new Error("projection_lease_lost");
      } catch (error) {
        await this.retryOrFail(task, error, performance.now() - startedAt);
      }
      return;
    }

    const controller = new AbortController();
    this.taskControllers.add(controller);
    let heartbeatRunning = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatRunning || controller.signal.aborted) return;
      heartbeatRunning = true;
      try {
        const current = await this.store.heartbeat(
          task,
          this.options.leaseSeconds,
        );
        if (!current) controller.abort(new Error("projection_lease_lost"));
      } catch {
        controller.abort(new Error("projection_lease_lost"));
      } finally {
        heartbeatRunning = false;
      }
    }, this.options.heartbeatSeconds * 1_000);

    try {
      const source = await this.store.loadSource(task);
      controller.signal.throwIfAborted();
      if (!source) {
        const current = await this.store.completeRemove(
          task,
          task.entityId,
          task.entityVersion.toString(),
          performance.now() - startedAt,
        );
        if (!current) throw new Error("projection_lease_lost");
        return;
      }
      const result = await this.project(source, this.now());
      controller.signal.throwIfAborted();
      const current =
        result.action === "upsert"
          ? await this.store.completeUpsert(
              task,
              result.row,
              result.sourceContentHash,
              performance.now() - startedAt,
            )
          : await this.store.completeRemove(
              task,
              result.canonicalGroupId,
              result.authoritativeVersion,
              performance.now() - startedAt,
            );
      if (!current) throw new Error("projection_lease_lost");
    } catch (error) {
      if (!controller.signal.aborted) {
        await this.retryOrFail(task, error, performance.now() - startedAt);
      }
    } finally {
      clearInterval(heartbeat);
      this.taskControllers.delete(controller);
    }
  }

  private async retryOrFail(
    task: JobProjectionLease,
    error: unknown,
    durationMs: number,
  ): Promise<void> {
    const exhausted = task.attempts >= task.maxAttempts;
    const failureCode =
      error instanceof Error && error.message === "projection_lease_lost"
        ? "lease_lost"
        : "projection_failed";
    await this.store.finish(task, exhausted ? "failed" : "retryable", {
      errorCode: exhausted ? "retry_exhausted" : failureCode,
      // Persist only an enumerated class. Raw exception text can contain
      // canonical source data or driver details and belongs in redacted logs.
      errorMessage: undefined,
      retryAt: exhausted
        ? undefined
        : new Date(Date.now() + Math.min(60_000, 250 * 2 ** task.attempts)),
      durationMs,
    });
  }

  stopClaiming(): void {
    this.controller.abort();
  }

  async stop(timeoutMs: number): Promise<void> {
    this.stopClaiming();
    const drain = () =>
      Promise.allSettled(
        [...this.active, this.runPromise].filter(
          (promise): promise is Promise<void> => Boolean(promise),
        ),
      );
    const drained = await Promise.race([
      drain().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (!drained) {
      for (const controller of this.taskControllers) {
        controller.abort(new Error("shutdown_deadline"));
      }
      // Do not add an unbounded second drain after the declared deadline.
      // allSettled keeps late abort completions observed while pool shutdown
      // provides the final transport fence.
      void drain();
    }
  }
}
