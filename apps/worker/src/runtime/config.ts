import { parseWorkerConfig, type WorkerConfig } from "@hirly/config";
import { z } from "zod";

const runtimeConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65_535).default(3001),
  WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
  WORKER_SCHEDULE_POLL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(300_000)
    .default(5_000),
  WORKER_SHUTDOWN_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(25_000)
    .default(25_000),
  WORKER_INSTANCE_ID: z.string().trim().min(1).max(128).optional(),
  JOB_PROJECTION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PROJECTION_RECONCILIATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  JOB_PROJECTION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  JOB_PROJECTION_RECONCILIATION_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(100),
});

export interface RuntimeConfig extends WorkerConfig {
  PORT: number;
  WORKER_POLL_MS: number;
  WORKER_SCHEDULE_POLL_MS: number;
  WORKER_SHUTDOWN_MS: number;
  WORKER_INSTANCE_ID: string;
  JOB_PROJECTION_ENABLED: boolean;
  PROJECTION_RECONCILIATION_ENABLED: boolean;
  JOB_PROJECTION_BATCH_SIZE: number;
  JOB_PROJECTION_RECONCILIATION_BATCH_SIZE: number;
}

export function parseRuntimeConfig(
  environment: Record<string, string | undefined>,
): RuntimeConfig {
  const worker = parseWorkerConfig(environment);
  const runtime = runtimeConfigSchema.parse(environment);
  return {
    ...worker,
    ...runtime,
    WORKER_INSTANCE_ID:
      runtime.WORKER_INSTANCE_ID ??
      `${environment.RAILWAY_REPLICA_ID ?? "local"}-${crypto.randomUUID()}`,
  };
}
