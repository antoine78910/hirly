import {
  canonicalAnalyticsUserIdSchema,
  getAnalyticsEventDefinition,
  resolveAnalyticsEventName,
  sanitizeAnalyticsProperties,
  type AnalyticsTimestampQuality,
} from "@hirly/contracts";
import { createHash } from "node:crypto";

export const ANALYTICS_BACKFILL_TRANSFORM_VERSION =
  "hirly.analytics-backfill.v2" as const;

export type LegacyIdentityResolution =
  | "canonical_uuid"
  | "anonymous_unlinked"
  | "anonymous_one_to_one"
  | "anonymous_ambiguous"
  | "known_user_unresolved"
  | "known_user_ambiguous"
  | "no_identity";

const legacyIdentityResolutions = new Set<LegacyIdentityResolution>([
  "canonical_uuid",
  "anonymous_unlinked",
  "anonymous_one_to_one",
  "anonymous_ambiguous",
  "known_user_unresolved",
  "known_user_ambiguous",
  "no_identity",
]);

const anonymousAttributionByResolution: Partial<
  Record<LegacyIdentityResolution, "unlinked" | "one_to_one" | "ambiguous">
> = {
  anonymous_unlinked: "unlinked",
  anonymous_one_to_one: "one_to_one",
  anonymous_ambiguous: "ambiguous",
};

export interface LegacyAnalyticsRow {
  eventId: string;
  eventName: string;
  createdAt: string;
  exactBusinessTimestamp?: string | null;
  userId?: unknown;
  anonymousId?: string | null;
  identityResolution?: LegacyIdentityResolution;
  properties: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseLegacyAnalyticsRows(value: unknown): LegacyAnalyticsRow[] {
  if (!Array.isArray(value)) throw new Error("invalid_input:expected_array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`invalid_input_row:${index}:object`);
    for (const field of ["eventId", "eventName", "createdAt"] as const) {
      if (typeof entry[field] !== "string") {
        throw new Error(`invalid_input_row:${index}:${field}`);
      }
    }
    if (!isRecord(entry.properties)) {
      throw new Error(`invalid_input_row:${index}:properties`);
    }
    if (
      entry.exactBusinessTimestamp !== undefined &&
      entry.exactBusinessTimestamp !== null &&
      typeof entry.exactBusinessTimestamp !== "string"
    ) {
      throw new Error(`invalid_input_row:${index}:exactBusinessTimestamp`);
    }
    if (
      entry.anonymousId !== undefined &&
      entry.anonymousId !== null &&
      typeof entry.anonymousId !== "string"
    ) {
      throw new Error(`invalid_input_row:${index}:anonymousId`);
    }
    if (
      entry.identityResolution !== undefined &&
      (typeof entry.identityResolution !== "string" ||
        !legacyIdentityResolutions.has(
          entry.identityResolution as LegacyIdentityResolution,
        ))
    ) {
      throw new Error(`invalid_input_row:${index}:identityResolution`);
    }
    return entry as unknown as LegacyAnalyticsRow;
  });
}

export type IdentityQuality =
  | "identified_at_ingest"
  | "legacy_anonymous_unlinked"
  | "legacy_anonymous_one_to_one"
  | "legacy_anonymous_ambiguous"
  | "unknown";

export interface TransformedPostHogEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, boolean | number | string>;
}

export interface BackfillDisposition {
  sourceEventId: string;
  sourceCreatedAt: string;
  canonicalEventName: string | null;
  transformVersion: typeof ANALYTICS_BACKFILL_TRANSFORM_VERSION;
  payloadHash: string;
  timestampQuality: AnalyticsTimestampQuality;
  identityQuality: IdentityQuality;
  status: "pending" | "excluded" | "quarantined";
  reason: string | null;
  payload: TransformedPostHogEvent | null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function stablePayloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function validInstant(value: string | null | undefined): string | null {
  if (!value || !/Z$|[+-]\d\d:\d\d$/.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

function identity(row: LegacyAnalyticsRow): {
  distinctId: string | null;
  quality: IdentityQuality;
  personless: boolean;
  quarantineReason: string | null;
} {
  if (!row.identityResolution) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: false,
      quarantineReason: "missing_identity_resolution",
    };
  }
  if (
    row.identityResolution === "known_user_unresolved" ||
    row.identityResolution === "known_user_ambiguous"
  ) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: false,
      quarantineReason: row.identityResolution,
    };
  }
  if (row.identityResolution === "no_identity") {
    return {
      distinctId: null,
      quality: "unknown",
      personless: true,
      quarantineReason: "missing_identity",
    };
  }
  const known = canonicalAnalyticsUserIdSchema.safeParse(row.userId);
  if (row.identityResolution === "canonical_uuid" && known.success) {
    return {
      distinctId: known.data,
      quality: "identified_at_ingest",
      personless: false,
      quarantineReason: null,
    };
  }
  if (row.identityResolution === "canonical_uuid") {
    return {
      distinctId: null,
      quality: "unknown",
      personless: false,
      quarantineReason: "invalid_known_identity",
    };
  }
  if (row.userId !== null && row.userId !== undefined) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: false,
      quarantineReason: "identity_resolution_mismatch",
    };
  }
  const attribution = anonymousAttributionByResolution[row.identityResolution];
  if (!attribution) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: false,
      quarantineReason: "invalid_identity_resolution",
    };
  }
  if (!row.anonymousId?.trim()) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: true,
      quarantineReason: "missing_identity",
    };
  }
  return {
    // Anonymous history is deliberately namespaced and never aliased to a user,
    // including observed one-to-one mappings.
    distinctId: `legacy-anonymous:${stablePayloadHash(row.anonymousId).slice(0, 32)}`,
    quality: `legacy_anonymous_${attribution}`,
    personless: true,
    quarantineReason: null,
  };
}

const denylistedProperty = /(?:^|_)(?:email|name|phone|cv|resume|token|secret|password|free_?text)(?:_|$)/i;

export function transformLegacyAnalyticsRow(
  row: LegacyAnalyticsRow,
): BackfillDisposition {
  const sourceCreatedAt = validInstant(row.createdAt);
  const canonicalEventName = resolveAnalyticsEventName(row.eventName);
  const occurrence = validInstant(row.exactBusinessTimestamp);
  const timestampQuality: AnalyticsTimestampQuality = occurrence
    ? "exact_business_timestamp"
    : sourceCreatedAt
      ? "server_received_at"
      : "unknown";
  const resolvedIdentity = identity(row);
  const base = {
    sourceEventId: row.eventId,
    sourceCreatedAt: sourceCreatedAt ?? row.createdAt,
    canonicalEventName,
    transformVersion: ANALYTICS_BACKFILL_TRANSFORM_VERSION,
    timestampQuality,
    identityQuality: resolvedIdentity.quality,
  };
  const quarantine = (reason: string): BackfillDisposition => {
    const value = { ...base, status: "quarantined", reason, payload: null } as const;
    return { ...value, payloadHash: stablePayloadHash(value) };
  };
  const exclude = (reason: string): BackfillDisposition => {
    const value = { ...base, status: "excluded", reason, payload: null } as const;
    return { ...value, payloadHash: stablePayloadHash(value) };
  };

  if (!row.eventId.trim()) return quarantine("missing_source_event_id");
  if (!sourceCreatedAt) return quarantine("invalid_source_created_at");
  if (!canonicalEventName) return quarantine("unknown_event");
  if (resolvedIdentity.quarantineReason) {
    return quarantine(resolvedIdentity.quarantineReason);
  }
  if (!resolvedIdentity.distinctId) return quarantine("missing_identity");
  const definition = getAnalyticsEventDefinition(canonicalEventName);
  if (!definition) return quarantine("unknown_event");
  if (
    timestampQuality !== "exact_business_timestamp" ||
    !definition.canonicalTimeQualities.includes(timestampQuality)
  ) {
    return exclude("noncanonical_timestamp_quality");
  }
  if (Object.keys(row.properties).some((key) => denylistedProperty.test(key))) {
    return quarantine("denylisted_property");
  }
  const sanitized = sanitizeAnalyticsProperties(
    canonicalEventName,
    row.properties,
  );
  if (sanitized.rejectedProperties.length > 0) {
    return quarantine(
      `rejected_properties:${sanitized.rejectedProperties.join(",")}`,
    );
  }
  if (sanitized.missingRequiredProperties.length > 0) {
    return quarantine(
      `missing_required_properties:${sanitized.missingRequiredProperties.join(",")}`,
    );
  }
  const payload: TransformedPostHogEvent = {
    event: canonicalEventName,
    distinct_id: resolvedIdentity.distinctId,
    timestamp: occurrence!,
    properties: {
      ...sanitized.properties,
      historical_migration: true,
      schema_version: definition.schemaVersion,
      event_source: "historical-only",
      timestamp_quality: timestampQuality,
      identity_quality: resolvedIdentity.quality,
      ...(resolvedIdentity.personless
        ? { $process_person_profile: false }
        : {}),
    },
  };
  const value = { ...base, status: "pending", reason: null, payload } as const;
  return { ...value, payloadHash: stablePayloadHash(value) };
}

export interface BackfillCheckpoint {
  createdAt: string;
  eventId: string;
}

export function afterCheckpoint(
  row: LegacyAnalyticsRow,
  checkpoint: BackfillCheckpoint | null,
): boolean {
  if (!checkpoint) return true;
  return (
    row.createdAt > checkpoint.createdAt ||
    (row.createdAt === checkpoint.createdAt && row.eventId > checkpoint.eventId)
  );
}

export function orderLegacyRows(
  rows: LegacyAnalyticsRow[],
): LegacyAnalyticsRow[] {
  return [...rows].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.eventId.localeCompare(right.eventId),
  );
}
