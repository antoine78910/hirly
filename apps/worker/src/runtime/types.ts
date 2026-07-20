import type {
  ClaimedTask,
  Lease,
  WorkerRepository,
} from "@hirly/db";
import type { EnqueueRun, Provider, RunView } from "@hirly/contracts";

export type QueueRepository = Pick<
  WorkerRepository,
  "claim" | "heartbeat" | "finish" | "enqueue" | "ping" | "close"
>;

export interface RuntimeStore {
  assertProviderRunnable(provider: Provider): Promise<void>;
  dueSchedules(limit: number): Promise<DueSchedule[]>;
  enqueueDueSchedule(scheduleId: string, nextDueAt: Date): Promise<string | null>;
  getRun(runId: string): Promise<RunView | null>;
}

export interface DueSchedule {
  id: string;
  cronExpression: string;
  timezone: string;
  nextDueAt: Date;
  maxCatchUp: number;
}

export interface TaskHandler {
  (task: ClaimedTask, signal: AbortSignal): Promise<void>;
}

export interface TaskHandlers {
  [taskType: string]: TaskHandler | undefined;
}

export interface ConsumerRepository extends QueueRepository {
  finish(
    lease: Lease,
    outcome: "succeeded" | "retryable" | "failed" | "cancelled",
    options?: {
      errorCode?: string;
      errorMessage?: string;
      retryAt?: Date;
    },
  ): Promise<boolean>;
}

export interface Enqueuer {
  enqueue(input: EnqueueRun): Promise<string>;
}
