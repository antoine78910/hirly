import {
  runViewSchema,
  type Provider,
  type RunView,
} from "@hirly/contracts";
import type { Database, WorkerRepository } from "@hirly/db";
import type { DueSchedule, RuntimeStore } from "./types";

export class PostgresRuntimeStore implements RuntimeStore {
  constructor(
    private readonly sql: Database,
    private readonly repository: WorkerRepository,
  ) {}

  async assertProviderRunnable(provider: Provider): Promise<void> {
    const [row] = await this.sql<
      {
        authorization_status: string;
        enabled: boolean;
        writer_runtime: string;
      }[]
    >`
      SELECT authorization_status, enabled, writer_runtime
      FROM public.provider_registry
      WHERE provider = ${provider}
    `;
    if (
      !row ||
      row.authorization_status !== "authorized" ||
      !row.enabled ||
      row.writer_runtime !== "typescript"
    ) {
      throw new Error("authorization_blocked");
    }
  }

  async dueSchedules(limit: number): Promise<DueSchedule[]> {
    const rows = await this.sql<
      {
        id: string;
        cron_expression: string;
        timezone: string;
        next_due_at: Date;
      }[]
    >`
      SELECT id, cron_expression, timezone, next_due_at
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
    }));
  }

  enqueueDueSchedule(
    scheduleId: string,
    nextDueAt: Date,
  ): Promise<string | null> {
    return this.repository.enqueueDueSchedule(scheduleId, nextDueAt);
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
      SELECT id, kind, provider, trigger_source, status, requested_at,
        started_at, finished_at, summary, error_code
      FROM public.worker_runs
      WHERE id = ${runId}::uuid
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
}
