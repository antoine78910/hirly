import { z } from "zod";
import analyticsRegistryDocument from "./analytics-registry.v1.json";

export const ANALYTICS_REGISTRY_VERSION = "hirly.analytics-registry.v1" as const;

export const analyticsEventSourceSchema = z.enum([
  "frontend",
  "backend",
  "historical-only",
]);
export const analyticsIdentityPolicySchema = z.enum([
  "anonymous",
  "identified",
  "either",
  "system",
]);
export const analyticsPropertyTypeSchema = z.enum([
  "boolean",
  "integer",
  "number",
  "string",
  "timestamp",
]);
export const analyticsPrivacyClassSchema = z.enum([
  "public",
  "pseudonymous",
  "sensitive",
]);
export const analyticsTimestampQualitySchema = z.enum([
  "exact_business_timestamp",
  "validated_client_occurrence",
  "server_received_at",
  "unknown",
]);

export const canonicalAnalyticsUserIdSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), {
    message: "analytics user IDs must use canonical lowercase UUID serialization",
  })
  .refine(
    (value) =>
      !["anonymous", "guest", "system", "backend", "cron"].includes(
        value.toLowerCase(),
      ),
    { message: "generic analytics identities are not allowed" },
  );

const analyticsPropertyDefinitionSchema = z
  .object({
    type: analyticsPropertyTypeSchema,
    privacy: analyticsPrivacyClassSchema,
  })
  .strict();

export const analyticsEventDefinitionSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
      .max(96),
    schemaVersion: z.literal(1),
    definition: z.string().trim().min(1).max(500),
    identityPolicy: analyticsIdentityPolicySchema,
    authoritativeSource: analyticsEventSourceSchema,
    semanticDeduplicationKey: z.string().trim().min(1).max(128).nullable(),
    canonicalTimeQualities: z.array(analyticsTimestampQualitySchema).min(1),
    requiredProperties: z.record(
      z.string().regex(/^[a-z$][a-z0-9_$]*$/),
      analyticsPropertyDefinitionSchema,
    ),
    optionalProperties: z.record(
      z.string().regex(/^[a-z$][a-z0-9_$]*$/),
      analyticsPropertyDefinitionSchema,
    ),
    legacyAliases: z.array(z.string().trim().min(1).max(96)),
  })
  .strict()
  .superRefine((event, context) => {
    for (const property of Object.keys(event.requiredProperties)) {
      if (property in event.optionalProperties) {
        context.addIssue({
          code: "custom",
          message: "a property cannot be both required and optional",
          path: ["optionalProperties", property],
        });
      }
    }
  });

export const analyticsRegistrySchema = z
  .object({
    schemaVersion: z.literal(ANALYTICS_REGISTRY_VERSION),
    events: z.array(analyticsEventDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const names = new Set<string>();
    const aliases = new Set<string>();
    for (const [index, event] of registry.events.entries()) {
      if (names.has(event.name)) {
        context.addIssue({
          code: "custom",
          message: "canonical event names must be unique",
          path: ["events", index, "name"],
        });
      }
      names.add(event.name);
      for (const alias of event.legacyAliases) {
        if (names.has(alias) || aliases.has(alias)) {
          context.addIssue({
            code: "custom",
            message: "legacy aliases must resolve to exactly one canonical event",
            path: ["events", index, "legacyAliases"],
          });
        }
        aliases.add(alias);
      }
    }
  });

export const analyticsRegistry = analyticsRegistrySchema.parse(
  analyticsRegistryDocument,
);

export type AnalyticsEventDefinition = z.infer<
  typeof analyticsEventDefinitionSchema
>;
export type AnalyticsTimestampQuality = z.infer<
  typeof analyticsTimestampQualitySchema
>;

const definitionsByName = new Map(
  analyticsRegistry.events.map((event) => [event.name, event]),
);
const canonicalNameByAlias = new Map(
  analyticsRegistry.events.flatMap((event) =>
    event.legacyAliases.map((alias) => [alias, event.name] as const),
  ),
);

export function resolveAnalyticsEventName(name: string): string | null {
  if (definitionsByName.has(name)) return name;
  return canonicalNameByAlias.get(name) ?? null;
}

export function getAnalyticsEventDefinition(
  name: string,
): AnalyticsEventDefinition | null {
  const canonicalName = resolveAnalyticsEventName(name);
  return canonicalName ? (definitionsByName.get(canonicalName) ?? null) : null;
}

function propertyMatchesType(
  value: unknown,
  expected: z.infer<typeof analyticsPropertyTypeSchema>,
): boolean {
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expected === "timestamp") {
    return (
      typeof value === "string" &&
      z.iso.datetime({ offset: true }).safeParse(value).success
    );
  }
  return typeof value === "string";
}

export interface SanitizedAnalyticsProperties {
  properties: Record<string, boolean | number | string>;
  rejectedProperties: string[];
  missingRequiredProperties: string[];
}

export function sanitizeAnalyticsProperties(
  eventName: string,
  input: Record<string, unknown>,
): SanitizedAnalyticsProperties {
  const definition = getAnalyticsEventDefinition(eventName);
  if (!definition) {
    throw new Error(`unknown analytics event: ${eventName}`);
  }
  const allowed = {
    ...definition.requiredProperties,
    ...definition.optionalProperties,
  };
  const properties: Record<string, boolean | number | string> = {};
  const rejectedProperties: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const propertyDefinition = allowed[key];
    if (
      !propertyDefinition ||
      propertyDefinition.privacy === "sensitive" ||
      !propertyMatchesType(value, propertyDefinition.type)
    ) {
      rejectedProperties.push(key);
      continue;
    }
    properties[key] = value as boolean | number | string;
  }
  const missingRequiredProperties = Object.keys(
    definition.requiredProperties,
  ).filter((key) => !(key in properties));
  return {
    properties,
    rejectedProperties: rejectedProperties.sort(),
    missingRequiredProperties,
  };
}

export interface AnalyticsOccurrence {
  occurredAt: string | null;
  receivedAt: string;
  timestampQuality: AnalyticsTimestampQuality;
  clockSkewMs: number | null;
}

export function classifyAnalyticsOccurrence(
  occurredAt: string | null | undefined,
  receivedAt: string,
): AnalyticsOccurrence {
  const received = z.iso.datetime({ offset: true }).parse(receivedAt);
  const receivedMs = Date.parse(received);
  if (!occurredAt || !z.iso.datetime({ offset: true }).safeParse(occurredAt).success) {
    return {
      occurredAt: null,
      receivedAt: received,
      timestampQuality: "server_received_at",
      clockSkewMs: null,
    };
  }
  const occurredMs = Date.parse(occurredAt);
  const clockSkewMs = occurredMs - receivedMs;
  if (clockSkewMs > 5 * 60_000 || clockSkewMs < -24 * 60 * 60_000) {
    return {
      occurredAt,
      receivedAt: received,
      timestampQuality: "server_received_at",
      clockSkewMs,
    };
  }
  return {
    occurredAt,
    receivedAt: received,
    timestampQuality: "validated_client_occurrence",
    clockSkewMs,
  };
}

export function systemAnalyticsProperties(): {
  $process_person_profile: false;
} {
  return { $process_person_profile: false };
}
