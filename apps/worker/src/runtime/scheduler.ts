import type { Logger } from "@hirly/observability";
import type { RuntimeStore } from "./types";
import { safeErrorMessage } from "./retry";

interface SchedulerOptions {
  pollMs: number;
  environment: string;
  serviceVersion: string;
}

export interface SchedulerTickOptions {
  now?: Date;
  limit?: number;
}

function fieldMatches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isInteger(step) && step > 0 && value % step === 0;
    }
    const [start, end] = part.split("-").map(Number);
    if (end !== undefined) return value >= start! && value <= end;
    return value === start;
  });
}

function zonedParts(date: Date, timezone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.find((part) => part.type === "weekday")?.value ?? "",
  );
  return [value("minute"), value("hour"), value("day"), value("month"), weekday];
}

export function nextCronOccurrence(expression: string, timezone: string, after: Date): Date {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("invalid cron expression");
  new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(after);
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let offset = 0; offset < 366 * 24 * 60; offset += 1) {
    const values = zonedParts(cursor, timezone);
    if (fields.every((field, index) => fieldMatches(field!, values[index]!))) {
      return cursor;
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error("cron has no occurrence within one year");
}

export async function runSchedulerTick(
  store: RuntimeStore,
  options: SchedulerTickOptions = {},
): Promise<number> {
  const schedules = await store.dueSchedules(options.limit ?? 25);
  let enqueued = 0;
  for (const schedule of schedules) {
    const now = options.now ?? schedule.databaseNow;
    let occurrence = schedule.nextDueAt;
    const catchUpLimit = Math.max(1, schedule.maxCatchUp);
    for (let index = 0; index < catchUpLimit && occurrence <= now; index += 1) {
      const successor = nextCronOccurrence(schedule.cronExpression, schedule.timezone, occurrence);
      const runId = await store.enqueueDueSchedule(schedule.id, successor);
      if (!runId) break;
      enqueued += 1;
      occurrence = successor;
    }
  }
  return enqueued;
}

export class Scheduler {
  private readonly controller = new AbortController();
  private promise: Promise<void> | null = null;

  constructor(
    private readonly store: RuntimeStore,
    private readonly logger: Logger,
    private readonly options: SchedulerOptions,
  ) {}

  start(): void {
    if (!this.promise) this.promise = this.run();
  }

  private async run(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        await runSchedulerTick(this.store);
      } catch (error) {
        this.logger.emit({
          service: "hirly-worker",
          version: this.options.serviceVersion,
          environment: this.options.environment,
          event: "worker.scheduler_failed",
          severity: "error",
          reasonCode: "database_unavailable",
          details: { message: safeErrorMessage(error) },
        });
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.options.pollMs);
        this.controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await this.promise;
  }
}
