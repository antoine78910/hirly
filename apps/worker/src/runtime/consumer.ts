import type { Logger } from "@hirly/observability";
import type { ClaimedTask } from "@hirly/db";
import {
  PermanentTaskError,
  retryDelayMs,
  safeErrorMessage,
} from "./retry";
import type { ConsumerRepository, TaskHandlers } from "./types";

export interface ConsumerOptions {
  concurrency: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  pollMs: number;
  instanceId: string;
  serviceVersion: string;
  environment: string;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export class Consumer {
  private readonly controller = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private runPromise: Promise<void> | null = null;

  constructor(
    private readonly repository: ConsumerRepository,
    private readonly handlers: TaskHandlers,
    private readonly logger: Logger,
    private readonly options: ConsumerOptions,
  ) {}

  start(): void {
    if (!this.runPromise) this.runPromise = this.run();
  }

  private async run(): Promise<void> {
    while (!this.controller.signal.aborted) {
      const capacity = this.options.concurrency - this.active.size;
      if (capacity <= 0) {
        await Promise.race(this.active);
        continue;
      }
      let tasks: ClaimedTask[] = [];
      try {
        tasks = await this.repository.claim(
          this.options.instanceId,
          capacity,
          this.options.leaseSeconds,
        );
      } catch (error) {
        this.logger.emit({
          service: "hirly-worker",
          version: this.options.serviceVersion,
          environment: this.options.environment,
          event: "worker.claim_failed",
          severity: "error",
          reasonCode: "database_unavailable",
          details: { message: safeErrorMessage(error) },
        });
      }
      if (tasks.length === 0) {
        await sleep(this.options.pollMs, this.controller.signal);
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

  private async execute(task: ClaimedTask): Promise<void> {
    const handler = this.handlers[task.taskType];
    const startedAt = performance.now();
    if (!handler) {
      await this.repository.finish(task, "failed", {
        errorCode: "invalid_input",
        errorMessage: `unsupported task type: ${task.taskType}`,
      });
      return;
    }

    const taskController = new AbortController();
    const heartbeat = setInterval(async () => {
      try {
        const current = await this.repository.heartbeat(
          task,
          this.options.leaseSeconds,
        );
        if (!current) taskController.abort(new Error("lease_lost"));
      } catch {
        taskController.abort(new Error("lease_lost"));
      }
    }, this.options.heartbeatSeconds * 1_000);

    let outcome: "succeeded" | "retryable" | "failed" = "succeeded";
    let reasonCode: string | undefined;
    try {
      await handler(task, taskController.signal);
      const current = await this.repository.finish(task, "succeeded");
      if (!current) throw new PermanentTaskError("lease_lost", "lease lost");
    } catch (error) {
      const permanent = error instanceof PermanentTaskError;
      const exhausted = task.attempts >= task.maxAttempts;
      reasonCode = permanent
        ? error.code
        : exhausted
          ? "retry_exhausted"
          : "provider_transient";
      outcome = permanent || exhausted ? "failed" : "retryable";
      const current = await this.repository.finish(task, outcome, {
        errorCode: reasonCode,
        errorMessage: safeErrorMessage(error),
        retryAt:
          outcome === "retryable"
            ? new Date(Date.now() + retryDelayMs(task.attempts))
            : undefined,
      });
      if (!current) {
        outcome = "failed";
        reasonCode = "lease_lost";
      }
    } finally {
      clearInterval(heartbeat);
      this.logger.emit({
        service: "hirly-worker",
        version: this.options.serviceVersion,
        environment: this.options.environment,
        event: "worker.task_terminal",
        severity: outcome === "succeeded" ? "info" : "warn",
        runId: task.runId,
        taskId: task.taskId,
        taskType: task.taskType,
        provider: task.provider ?? undefined,
        attempt: task.attempts,
        maxAttempts: task.maxAttempts,
        outcome,
        reasonCode,
        durationsMs: {
          queueWait: 0,
          fetch: 0,
          normalization: 0,
          validation: 0,
          database: 0,
          total: performance.now() - startedAt,
        },
      });
    }
  }

  async stop(timeoutMs: number): Promise<void> {
    this.controller.abort();
    const wait = Promise.allSettled([...this.active, this.runPromise].filter(Boolean));
    await Promise.race([
      wait,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  get activeCount(): number {
    return this.active.size;
  }
}

export function createConsumer(
  repository: ConsumerRepository,
  handlers: TaskHandlers,
  logger: Logger,
  options: ConsumerOptions,
): Consumer {
  return new Consumer(repository, handlers, logger, options);
}
