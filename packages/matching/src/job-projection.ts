import {
  MATCHING_CONTRACT_VERSION,
  toJobSearchDocumentPersistenceRow,
  type JobSearchDocumentPersistenceRow,
} from "@hirly/contracts";

export const JOB_FEATURE_SCHEMA_VERSION = "matching-job-features.v1";

export interface JobProjectionSource {
  canonicalGroupId: string;
  preferredJobId: string;
  /** Monotonic canonical-inventory watermark used for stale-task fencing. */
  authoritativeVersion: string;
  groupStatus: "active" | "split" | "superseded" | "archived";
  title: string;
  normalizedTitle: string | null;
  company: string;
  location: string;
  countryCode: string | null;
  remote: boolean | null;
  latitude: number | null;
  longitude: number | null;
  publishedAt: string | null;
  importedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  lifecycleState: string | null;
  validationStatus: string;
  applyabilityTier: string;
  applyFulfillmentStatus: string;
  autoApplySupported: boolean;
  manualFulfillmentReady: boolean;
  sourceEligible: boolean;
  policyEligible: boolean;
  data: Record<string, unknown>;
}

export type JobProjectionResult =
  | { action: "remove"; canonicalGroupId: string; authoritativeVersion: string }
  | {
      action: "upsert";
      canonicalGroupId: string;
      preferredJobId: string;
      authoritativeVersion: string;
      sourceContentHash: string;
      row: JobSearchDocumentPersistenceRow;
    };

export type JobProjectionChange =
  | {
      kind: "preferred_job_changed" | "lifecycle_changed";
      canonicalGroupId: string;
    }
  | {
      kind: "merged";
      canonicalGroupId: string;
      mergedGroupIds: readonly string[];
    }
  | {
      kind: "split";
      canonicalGroupId: string;
      splitGroupIds: readonly string[];
    };

/** Returns every group whose document must be rebuilt or removed for a change. */
export function affectedCanonicalGroupIds(change: JobProjectionChange): string[] {
  const related =
    change.kind === "merged"
      ? change.mergedGroupIds
      : change.kind === "split"
        ? change.splitGroupIds
        : [];
  return [...new Set([change.canonicalGroupId, ...related])].sort();
}

const token = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

function strings(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(values.map((entry) => token(String(entry))).filter(Boolean))]
    .sort()
    .slice(0, limit);
}

function read(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (source[key] != null) return source[key];
  return undefined;
}

function contractTypes(data: Record<string, unknown>): string[] {
  return strings(read(data, "contractTypes", "contract_types", "contractType", "contract_type"), 16).map(
    (value) =>
      ({ cdi: "permanent", permanent: "permanent", cdd: "fixed-term", stage: "internship" })[value] ?? value,
  );
}

function workModes(source: JobProjectionSource): Array<"onsite" | "hybrid" | "remote"> {
  const explicit = strings(read(source.data, "workModes", "work_modes", "remote"), 3);
  const mapped = explicit.flatMap((value) => {
    if (["remote", "full-remote", "teletravail"].includes(value)) return ["remote" as const];
    if (["hybrid", "hybride"].includes(value)) return ["hybrid" as const];
    if (["onsite", "on-site", "sur-site"].includes(value)) return ["onsite" as const];
    return [];
  });
  if (mapped.length > 0) return [...new Set(mapped)].sort();
  if (source.remote === true) return ["remote"];
  if (source.remote === false) return ["onsite"];
  return [];
}

function roleFamilies(source: JobProjectionSource): string[] {
  const explicit = strings(read(source.data, "roleFamilyIds", "role_family_ids", "roleFamilyCodes", "role_family_codes"), 32);
  if (explicit.length > 0) return explicit;
  const title = token(source.normalizedTitle ?? source.title);
  if (/security|securite/.test(title)) return ["security-engineering"];
  if (/data/.test(title)) return ["data-engineering"];
  if (/product/.test(title)) return ["product-management"];
  if (/developer|developpeur|engineer|full-?stack|backend|frontend|software/.test(title)) return ["software-engineering"];
  if (/marketing/.test(title)) return ["marketing"];
  if (/sales|commercial/.test(title)) return ["sales"];
  return [];
}

function lifecycle(source: JobProjectionSource, now: Date): "active" | "stale" | "removed" | "expired" | "blocked" {
  const explicit = source.lifecycleState;
  if (["active", "stale", "removed", "expired", "blocked"].includes(explicit ?? "")) {
    if (explicit === "active" && source.expiresAt && new Date(source.expiresAt) <= now) return "expired";
    return explicit as "active" | "stale" | "removed" | "expired" | "blocked";
  }
  if (source.expiresAt && new Date(source.expiresAt) <= now) return "expired";
  return "blocked";
}

function route(source: JobProjectionSource): "auto" | "assisted" | "manual" | "blocked" {
  if (
    source.applyabilityTier === "E" ||
    source.applyFulfillmentStatus.startsWith("blocked_") ||
    source.applyFulfillmentStatus === "discovery_only"
  ) return "blocked";
  if (source.autoApplySupported) return "auto";
  if (source.manualFulfillmentReady || source.applyFulfillmentStatus === "manual_ready") return "manual";
  return "assisted";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function iso(...values: Array<string | null>): string {
  const value = values.find(Boolean);
  if (!value) throw new Error("job projection source has no authoritative timestamp");
  return new Date(value).toISOString();
}

export async function projectJobSearchDocument(
  source: JobProjectionSource,
  projectedAt: Date,
): Promise<JobProjectionResult> {
  if (source.groupStatus !== "active") {
    return {
      action: "remove",
      canonicalGroupId: source.canonicalGroupId,
      authoritativeVersion: source.authoritativeVersion,
    };
  }
  if (!/^[1-9]\d*$/.test(source.authoritativeVersion)) {
    throw new Error("job projection authoritative version must be a positive decimal string");
  }
  const normalizedTitle = token(source.normalizedTitle ?? source.title);
  if (!normalizedTitle) throw new Error("job projection title normalizes to empty");
  const countryCode = source.countryCode?.trim().toUpperCase() ?? null;
  const validCountry = countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
  const coordinatesKnown = source.latitude != null && source.longitude != null;
  const roleFamilyIds = roleFamilies(source);
  const romeCodes = strings(read(source.data, "romeCodes", "rome_codes"), 32)
    .map((value) => value.toUpperCase())
    .filter((value) => /^[A-Z]\d{4}$/.test(value));
  const skillIds = strings(read(source.data, "skillIds", "skill_ids", "skills"), 256);
  const contractTypesValue = contractTypes(source.data);
  const workModesValue = workModes(source);
  const publishedAt = iso(source.publishedAt, source.firstSeenAt, source.importedAt, source.lastSeenAt);
  const hasAuthoritativeFreshness = source.lastSeenAt !== null;
  const lastSeenAt = iso(source.lastSeenAt, source.importedAt, source.firstSeenAt, source.publishedAt);
  const lifecycleStatus = lifecycle(source, projectedAt);
  const validationStatus: "valid" | "review" | "invalid" =
    source.validationStatus === "valid"
      ? "valid"
      : source.validationStatus === "invalid"
        ? "invalid"
        : "review";
  const applyabilityTier: "A" | "B" | "C" | "D" | "blocked" =
    source.applyabilityTier === "E"
      ? "blocked"
      : ["A", "B", "C", "D"].includes(source.applyabilityTier)
        ? (source.applyabilityTier as "A" | "B" | "C" | "D")
        : "blocked";
  const content = {
    canonicalGroupId: source.canonicalGroupId,
    preferredJobId: source.preferredJobId,
    normalizedTitle,
    roleFamilyIds,
    romeCodes,
    skillIds,
    contractTypes: contractTypesValue,
    workModes: workModesValue,
    countryCode: validCountry,
    latitude: coordinatesKnown ? source.latitude : null,
    longitude: coordinatesKnown ? source.longitude : null,
    publishedAt,
    lastSeenAt,
    expiresAt: source.expiresAt ? new Date(source.expiresAt).toISOString() : null,
    lifecycleStatus,
    validationStatus,
    applyabilityTier,
    fulfillmentRoute: route(source),
    sourceEligible: source.sourceEligible && hasAuthoritativeFreshness && source.lifecycleState !== null,
    policyEligible: source.policyEligible,
    featureSchemaVersion: JOB_FEATURE_SCHEMA_VERSION,
    searchText: [source.title, source.company, source.location, ...roleFamilyIds, ...romeCodes, ...skillIds]
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 8_192),
  };
  const sourceContentHash = await sha256(content);
  const row = toJobSearchDocumentPersistenceRow(
    {
      schemaVersion: MATCHING_CONTRACT_VERSION,
      canonicalGroupId: content.canonicalGroupId,
      preferredJobId: content.preferredJobId,
      jobVersion: source.authoritativeVersion,
      roleFamilyIds: content.roleFamilyIds,
      romeCodes: content.romeCodes,
      skillIds: content.skillIds,
      seniorityMin: null,
      seniorityMax: null,
      contractTypes: content.contractTypes,
      workModes: content.workModes,
      latitude: content.latitude,
      longitude: content.longitude,
      countryCode: content.countryCode,
      locationConfidence: coordinatesKnown ? 1 : validCountry ? 0.6 : 0,
      locationUnknown: !coordinatesKnown && !validCountry,
      publishedAt: content.publishedAt,
      lastSeenAt: content.lastSeenAt,
      expiresAt: content.expiresAt,
      lifecycleStatus: content.lifecycleStatus,
      validationStatus,
      applyabilityTier,
      fulfillmentRoute: content.fulfillmentRoute,
      sourceEligible: content.sourceEligible,
      policyEligible: content.policyEligible,
      featureSchemaVersion: content.featureSchemaVersion,
      projectedAt: projectedAt.toISOString(),
    },
    { normalizedTitle, searchText: content.searchText },
  );
  return {
    action: "upsert",
    canonicalGroupId: source.canonicalGroupId,
    preferredJobId: source.preferredJobId,
    authoritativeVersion: source.authoritativeVersion,
    sourceContentHash,
    row,
  };
}
