import { z } from "zod";

export const sproutFranceRegistrationSchema = z
  .object({
    provider: z.literal("sprout"),
    sourceKey: z.literal("sprout-france"),
    countryCodes: z.tuple([z.literal("FR")]),
    accessType: z.literal("authenticated_api"),
    authorizationStatus: z.enum(["unverified", "blocked", "authorized"]),
    writerRuntime: z.enum(["none", "python", "typescript"]),
    policyStatus: z.enum(["pending", "blocked", "expired", "approved"]),
    requestsPerMinute: z.number().int().positive().max(1),
    concurrency: z.literal(1),
    enabled: z.boolean(),
    transportEnabled: z.boolean(),
    incrementalEnabled: z.boolean(),
    backfillEnabled: z.boolean(),
    providerCountryKillSwitch: z.boolean(),
    sourceCountryKillSwitch: z.boolean(),
    approvedPageSize: z.number().int().positive().max(500).nullable(),
  })
  .strict();

export type SproutFranceRegistration = z.infer<
  typeof sproutFranceRegistrationSchema
>;

export const SPROUT_FRANCE_DISABLED_REGISTRATION =
  sproutFranceRegistrationSchema.parse({
    provider: "sprout",
    sourceKey: "sprout-france",
    countryCodes: ["FR"],
    accessType: "authenticated_api",
    authorizationStatus: "unverified",
    writerRuntime: "none",
    policyStatus: "pending",
    requestsPerMinute: 1,
    concurrency: 1,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    providerCountryKillSwitch: true,
    sourceCountryKillSwitch: true,
    approvedPageSize: null,
  });

export const sproutActivationSchema = sproutFranceRegistrationSchema.extend({
  policyEvidenceRef: z.string().trim().min(1).max(512).nullable(),
  redisplayAllowed: z.boolean(),
  fullTextRetentionAllowed: z.boolean(),
  credentialRef: z
    .string()
    .regex(/^secret:\/\/[a-z0-9][a-z0-9/_-]{2,127}$/),
});

export type SproutActivation = z.infer<typeof sproutActivationSchema>;

export function assertSproutActivationReady(
  input: SproutActivation,
  mode: "backfill" | "incremental",
): SproutActivation {
  const activation = sproutActivationSchema.parse(input);
  const modeEnabled =
    mode === "backfill"
      ? activation.backfillEnabled
      : activation.incrementalEnabled;
  if (
    activation.authorizationStatus !== "authorized" ||
    activation.writerRuntime !== "typescript" ||
    activation.policyStatus !== "approved" ||
    activation.policyEvidenceRef === null ||
    !activation.redisplayAllowed ||
    !activation.fullTextRetentionAllowed ||
    activation.approvedPageSize === null ||
    !activation.enabled ||
    !activation.transportEnabled ||
    !modeEnabled ||
    activation.providerCountryKillSwitch ||
    activation.sourceCountryKillSwitch
  ) {
    throw new Error("sprout_activation_blocked");
  }
  return activation;
}
