import {
  canonicalAnalyticsUserIdSchema,
  getAnalyticsEventDefinition,
  resolveAnalyticsEventName,
  sanitizeAnalyticsProperties,
  type AnalyticsTimestampQuality,
} from "@hirly/contracts";
import { createHash } from "node:crypto";

export const ANALYTICS_BACKFILL_TRANSFORM_VERSION =
  "hirly.analytics-backfill.v1" as const;

export type LegacyAttribution = "unlinked" | "one_to_one" | "ambiguous";

export interface LegacyAnalyticsRow {
  eventId: string;
  eventName: string;
  createdAt: string;
  exactBusinessTimestamp?: string | null;
  userId?: unknown;
  anonymousId?: string | null;
  anonymousAttribution?: LegacyAttribution;
  properties: Record<string, unknown>;
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
  invalidKnownIdentity: boolean;
} {
  const known = canonicalAnalyticsUserIdSchema.safeParse(row.userId);
  if (known.success) {
    return {
      distinctId: known.data,
      quality: "identified_at_ingest",
      personless: false,
      invalidKnownIdentity: false,
    };
  }
  if (row.userId !== null && row.userId !== undefined) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: false,
      invalidKnownIdentity: true,
    };
  }
  if (!row.anonymousId?.trim()) {
    return {
      distinctId: null,
      quality: "unknown",
      personless: true,
      invalidKnownIdentity: false,
    };
  }
  const attribution = row.anonymousAttribution ?? "unlinked";
  return {
    // Anonymous history is deliberately namespaced and never aliased to a user,
    // including observed one-to-one mappings.
    distinctId: `legacy-anonymous:${stablePayloadHash(row.anonymousId).slice(0, 32)}`,
    quality: `legacy_anonymous_${attribution}`,
    personless: true,
    invalidKnownIdentity: false,
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
  if (resolvedIdentity.invalidKnownIdentity) {
    return quarantine("invalid_known_identity");
  }
  if (!resolvedIdentity.distinctId) return quarantine("missing_identity");
  if (Object.keys(row.properties).some((key) => denylistedProperty.test(key))) {
    return quarantine("denylisted_property");
  }
  const definition = getAnalyticsEventDefinition(canonicalEventName);
  if (!definition) return quarantine("unknown_event");
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
  if (
    timestampQuality !== "exact_business_timestamp" ||
    !definition.canonicalTimeQualities.includes(timestampQuality)
  ) {
    return exclude("noncanonical_timestamp_quality");
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
