import { createHash } from "node:crypto";

export const FEED_EFFECTIVE_QUERY_VERSION = "hirly.feed.explicit-query.v1" as const;

export interface FeedExplicitQueryLocation {
  label: string;
  country: string | null;
  countryCode: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FeedEffectiveQueryPayload {
  version: typeof FEED_EFFECTIVE_QUERY_VERSION;
  role: string | null;
  radiusKm: number;
  locations: readonly FeedExplicitQueryLocation[];
  countryCode: string | null;
  workModes: readonly ("remote" | "hybrid" | "onsite")[];
  jobTypes: readonly string[];
  experienceLevels: readonly string[];
  freeTextLocations: readonly string[];
  minimumSalary: number;
  postedWithin: "any" | "1d" | "7d" | "30d" | null;
  onlyCompanies: readonly string[];
  hiddenCompanies: readonly string[];
  onlyIndustries: readonly string[];
  hiddenIndustries: readonly string[];
  includeUnknownLocation: boolean;
  includeUnknownSalary: boolean;
  includeNonAutoApply: boolean;
  onlyMyCountry: boolean;
}

export interface FeedEffectiveQuery extends FeedEffectiveQueryPayload {
  fingerprint: string;
}

const PAYLOAD_KEYS = [
  "countryCode",
  "experienceLevels",
  "freeTextLocations",
  "hiddenCompanies",
  "hiddenIndustries",
  "includeNonAutoApply",
  "includeUnknownLocation",
  "includeUnknownSalary",
  "jobTypes",
  "locations",
  "minimumSalary",
  "onlyCompanies",
  "onlyIndustries",
  "onlyMyCountry",
  "postedWithin",
  "radiusKm",
  "role",
  "version",
  "workModes",
] as const;
const LOCATION_KEYS = [
  "country",
  "countryCode",
  "label",
  "latitude",
  "longitude",
  "placeId",
] as const;

function cleanString(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new Error("invalid_explicit_query");
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximum) throw new Error("invalid_explicit_query");
  return cleaned;
}

function nullableString(value: unknown, maximum: number): string | null {
  return value === null ? null : cleanString(value, maximum);
}

function stringList(value: unknown, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems)
    throw new Error("invalid_explicit_query");
  return [...new Set(value.map((item) => cleanString(item, 128)))].sort();
}

function countryCode(value: unknown): string | null {
  if (value === null) return null;
  const normalized = cleanString(value, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new Error("invalid_explicit_query");
  return normalized;
}

function coordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error("invalid_explicit_query");
  }
  return value;
}

function location(value: unknown): FeedExplicitQueryLocation {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== [...LOCATION_KEYS].sort().join(",")
  ) {
    throw new Error("invalid_explicit_query");
  }
  const candidate = value as Record<string, unknown>;
  return {
    label: cleanString(candidate.label, 160),
    country: nullableString(candidate.country, 80),
    countryCode: countryCode(candidate.countryCode),
    placeId: nullableString(candidate.placeId, 256),
    latitude: coordinate(candidate.latitude, -90, 90),
    longitude: coordinate(candidate.longitude, -180, 180),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function normalizePayload(value: unknown): FeedEffectiveQueryPayload {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== [...PAYLOAD_KEYS].sort().join(",")
  ) {
    throw new Error("invalid_explicit_query");
  }
  const candidate = value as Record<string, unknown>;
  const radiusKm = candidate.radiusKm;
  const minimumSalary = candidate.minimumSalary;
  if (
    !Number.isInteger(radiusKm) ||
    (radiusKm as number) < 1 ||
    (radiusKm as number) > 500 ||
    !Number.isInteger(minimumSalary) ||
    (minimumSalary as number) < 0 ||
    (minimumSalary as number) > 10_000_000
  ) {
    throw new Error("invalid_explicit_query");
  }
  const postedWithin = candidate.postedWithin;
  if (postedWithin !== null && !["any", "1d", "7d", "30d"].includes(String(postedWithin))) {
    throw new Error("invalid_explicit_query");
  }
  if (!Array.isArray(candidate.locations) || candidate.locations.length > 8)
    throw new Error("invalid_explicit_query");
  const workModes = stringList(candidate.workModes, 3);
  if (workModes.some((mode) => !["remote", "hybrid", "onsite"].includes(mode)))
    throw new Error("invalid_explicit_query");
  for (const key of [
    "includeUnknownLocation",
    "includeUnknownSalary",
    "includeNonAutoApply",
    "onlyMyCountry",
  ] as const) {
    if (typeof candidate[key] !== "boolean") throw new Error("invalid_explicit_query");
  }
  return {
    version:
      candidate.version === FEED_EFFECTIVE_QUERY_VERSION
        ? candidate.version
        : (() => {
            throw new Error("invalid_explicit_query");
          })(),
    role: nullableString(candidate.role, 200),
    radiusKm: radiusKm as number,
    locations: candidate.locations.map(location).sort((a, b) => {
      const left = canonicalJson(a);
      const right = canonicalJson(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    countryCode: countryCode(candidate.countryCode),
    workModes: workModes as FeedEffectiveQueryPayload["workModes"],
    jobTypes: stringList(candidate.jobTypes, 16),
    experienceLevels: stringList(candidate.experienceLevels, 16),
    freeTextLocations: stringList(candidate.freeTextLocations, 16),
    minimumSalary: minimumSalary as number,
    postedWithin: postedWithin as FeedEffectiveQueryPayload["postedWithin"],
    onlyCompanies: stringList(candidate.onlyCompanies, 20),
    hiddenCompanies: stringList(candidate.hiddenCompanies, 20),
    onlyIndustries: stringList(candidate.onlyIndustries, 20),
    hiddenIndustries: stringList(candidate.hiddenIndustries, 20),
    includeUnknownLocation: candidate.includeUnknownLocation as boolean,
    includeUnknownSalary: candidate.includeUnknownSalary as boolean,
    includeNonAutoApply: candidate.includeNonAutoApply as boolean,
    onlyMyCountry: candidate.onlyMyCountry as boolean,
  };
}

export function fingerprintFeedEffectiveQuery(payload: FeedEffectiveQueryPayload): string {
  return createHash("sha256")
    .update(canonicalJson(normalizePayload(payload)))
    .digest("hex");
}

export function createFeedEffectiveQuery(payload: FeedEffectiveQueryPayload): FeedEffectiveQuery {
  const normalized = normalizePayload(payload);
  return { ...normalized, fingerprint: fingerprintFeedEffectiveQuery(normalized) };
}

export function isFeedEffectiveQuery(value: unknown): value is FeedEffectiveQuery {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== [...PAYLOAD_KEYS, "fingerprint"].sort().join(",") ||
    typeof candidate.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.fingerprint)
  )
    return false;
  try {
    const payload = Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, candidate[key]]));
    const normalized = normalizePayload(payload);
    return (
      canonicalJson(payload) === canonicalJson(normalized) &&
      candidate.fingerprint === fingerprintFeedEffectiveQuery(normalized)
    );
  } catch {
    return false;
  }
}
