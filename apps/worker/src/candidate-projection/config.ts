import { z } from "zod";

const optionalPostgresUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "primary database URL must use postgres or postgresql",
    )
    .optional(),
);

const schema = z
  .object({
    CANDIDATE_PROJECTION_RELAY_ENABLED: z.enum(["true", "false"]).default("false"),
    CANDIDATE_PROJECTION_PRIMARY_DATABASE_URL: optionalPostgresUrl,
    CANDIDATE_PROJECTION_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    CANDIDATE_PROJECTION_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    CANDIDATE_PROJECTION_LEASE_SECONDS: z.coerce.number().int().min(5).max(3_600).default(120),
  })
  .superRefine((value, context) => {
    if (
      value.CANDIDATE_PROJECTION_RELAY_ENABLED === "true" &&
      !value.CANDIDATE_PROJECTION_PRIMARY_DATABASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["CANDIDATE_PROJECTION_PRIMARY_DATABASE_URL"],
        message: "primary database URL is required when candidate projection relay is enabled",
      });
    }
  });

export type CandidateProjectionRuntimeConfig =
  | {
      enabled: false;
      primaryDatabaseUrl: undefined;
      pollMs: number;
      batchSize: number;
      leaseSeconds: number;
    }
  | {
      enabled: true;
      primaryDatabaseUrl: string;
      pollMs: number;
      batchSize: number;
      leaseSeconds: number;
    };

export function parseCandidateProjectionRuntimeConfig(
  environment: Record<string, string | undefined>,
): CandidateProjectionRuntimeConfig {
  const value = schema.parse(environment);
  const shared = {
    pollMs: value.CANDIDATE_PROJECTION_POLL_MS,
    batchSize: value.CANDIDATE_PROJECTION_BATCH_SIZE,
    leaseSeconds: value.CANDIDATE_PROJECTION_LEASE_SECONDS,
  };
  if (value.CANDIDATE_PROJECTION_RELAY_ENABLED === "true") {
    const primaryDatabaseUrl = value.CANDIDATE_PROJECTION_PRIMARY_DATABASE_URL;
    if (!primaryDatabaseUrl) {
      throw new Error(
        "primary database URL is required when candidate projection relay is enabled",
      );
    }
    return { enabled: true, primaryDatabaseUrl, ...shared };
  }
  return {
    enabled: false,
    primaryDatabaseUrl: undefined,
    ...shared,
  };
}
