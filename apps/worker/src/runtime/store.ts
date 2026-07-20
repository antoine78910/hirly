import type { Provider, RunView } from "@hirly/contracts";
import type { WorkerRepository } from "@hirly/db";
import type { DueSchedule, RuntimeStore } from "./types";

export class PostgresRuntimeStore implements RuntimeStore {
  constructor(
    private readonly repository: WorkerRepository,
  ) {}

  async assertProviderRunnable(provider: Provider): Promise<void> {
    return this.repository.assertProviderRunnable(provider);
  }

  async dueSchedules(limit: number): Promise<DueSchedule[]> {
    const rows = await this.sql<
      {
        id: string;
        cron_expression: string;
        timezone: string;
        next_due_at: Date;
        max_catch_up: number;
      }[]
    >`
      SELECT id, cron_expression, timezone, next_due_at, max_catch_up
      FROM public.worker_schedules
      WHERE enabled AND next_due_at <= clock_timestamp()
      ORDER BY next_due_at, id
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      nextDueAt: row.next_due_at,
      maxCatchUp: row.max_catch_up,
    }));
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
}
