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
});

export interface RuntimeConfig extends WorkerConfig {
  PORT: number;
  WORKER_POLL_MS: number;
  WORKER_SCHEDULE_POLL_MS: number;
  WORKER_SHUTDOWN_MS: number;
  WORKER_INSTANCE_ID: string;
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
