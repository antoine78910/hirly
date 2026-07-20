import { z } from "zod";

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

export const workerConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    JOBS_DATABASE_URL: z.url({ protocol: /^postgres(ql)?:$/ }),
    WORKER_CONCURRENCY: positiveInteger(4).pipe(z.number().max(100)),
    WORKER_LEASE_SECONDS: positiveInteger(120).pipe(z.number().min(5).max(3_600)),
    WORKER_HEARTBEAT_SECONDS: positiveInteger(30).pipe(z.number().min(1).max(1_800)),
    WORKER_CONTROL_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    WORKER_CONTROL_TOKEN: z.string().trim().min(32).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.WORKER_HEARTBEAT_SECONDS >= value.WORKER_LEASE_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_HEARTBEAT_SECONDS"],
        message: "heartbeat interval must be shorter than lease duration",
      });
    }
    if (value.WORKER_CONTROL_ENABLED && !value.WORKER_CONTROL_TOKEN) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_CONTROL_TOKEN"],
        message: "control token is required when the control plane is enabled",
      });
    }
    if (value.NODE_ENV === "production") {
      const databaseUrl = new URL(value.JOBS_DATABASE_URL);
      const sslMode = databaseUrl.searchParams.get("sslmode");
      if (!["require", "verify-ca", "verify-full"].includes(sslMode ?? "")) {
        context.addIssue({
          code: "custom",
          path: ["JOBS_DATABASE_URL"],
          message:
            "production inventory database URL must require TLS with sslmode",
        });
      }
    }
  });

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function parseWorkerConfig(
  environment: Record<string, string | undefined>,
): WorkerConfig {
  return workerConfigSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    JOBS_DATABASE_URL: environment.JOBS_DATABASE_URL,
    WORKER_CONCURRENCY: environment.WORKER_CONCURRENCY,
    WORKER_LEASE_SECONDS: environment.WORKER_LEASE_SECONDS,
    WORKER_HEARTBEAT_SECONDS: environment.WORKER_HEARTBEAT_SECONDS,
    WORKER_CONTROL_ENABLED: environment.WORKER_CONTROL_ENABLED,
    WORKER_CONTROL_TOKEN: environment.WORKER_CONTROL_TOKEN,
  });
}

export const clientConfigSchema = z.object({}).strict();

export function parseClientConfig(
  environment: Record<string, string | undefined>,
): Record<string, never> {
  const publicEntries = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.startsWith("NEXT_PUBLIC_")),
  );
  return clientConfigSchema.parse(publicEntries);
}
