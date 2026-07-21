import {
  IngestionError,
  type NormalizedProviderJob,
} from "@hirly/ingestion";
import type { Provider } from "@hirly/contracts";
import {
  sproutRawJobSchema,
  type SproutLocation,
  type SproutRawJob,
} from "./schema";

const SPROUT_PROVIDER = "sprout" as Provider;

export interface NormalizedSproutLocation {
  countryCode: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  display: string;
  latitude: number | null;
  longitude: number | null;
}

export interface NormalizedSproutJob extends NormalizedProviderJob {
  city: string | null;
  region: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  postedAt: string | null;
  importedAt: string | null;
  lastSeenAt: string | null;
  allLocations: NormalizedSproutLocation[];
}

export type SproutNormalizationResult =
  | { accepted: true; job: NormalizedSproutJob }
  | {
      accepted: false;
      reason: "country_leak" | "missing_apply_url" | "invalid_apply_url";
      externalId: string;
    };

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function countryCode(location: SproutLocation): string | null {
  const explicit = cleanText(location.countryCode)?.toUpperCase();
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit;
  const country = cleanText(location.country)?.toUpperCase();
  if (country === "FR" || country === "FRA" || country === "FRANCE") {
    return "FR";
  }
  return null;
}

function nonZeroCoordinate(value: number | null | undefined): number | null {
  return value === null || value === undefined || value === 0 ? null : value;
}

export function normalizeSproutLocation(
  location: SproutLocation,
): NormalizedSproutLocation {
  const coordinates = location.coordinates;
  const coordinateLatitude = Array.isArray(coordinates)
    ? coordinates[1]
    : coordinates?.latitude;
  const coordinateLongitude = Array.isArray(coordinates)
    ? coordinates[0]
    : coordinates?.longitude;
  const city = cleanText(location.city);
  const region = cleanText(location.region) ?? cleanText(location.state);
  const country = cleanText(location.country);
  const code = countryCode(location);
  const display = [city, region, country ?? code]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ");
  return {
    countryCode: code,
    country,
    city,
    region,
    display: display || "France",
    latitude: nonZeroCoordinate(location.latitude ?? coordinateLatitude),
    longitude: nonZeroCoordinate(location.longitude ?? coordinateLongitude),
  };
}

function primaryLocation(
  locations: readonly NormalizedSproutLocation[],
): NormalizedSproutLocation | null {
  return (
    [...locations]
      .filter((location) => location.countryCode === "FR")
      .sort((left, right) => {
        const leftScore = Number(Boolean(left.city)) + Number(Boolean(left.region));
        const rightScore = Number(Boolean(right.city)) + Number(Boolean(right.region));
        return rightScore - leftScore || left.display.localeCompare(right.display);
      })[0] ?? null
  );
}

export function hasSproutFranceLocation(rawValue: SproutRawJob): boolean {
  const raw = sproutRawJobSchema.parse(rawValue);
  return raw.locations.some(
    (location) => normalizeSproutLocation(location).countryCode === "FR",
  );
}

function requireApplyUrl(value: string | null | undefined): string {
  const raw = cleanText(value);
  if (!raw) {
    throw new IngestionError(
      "invalid_input",
      "Sprout job is missing its posting URL",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new IngestionError("invalid_input", "Sprout posting URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname
  ) {
    throw new IngestionError(
      "invalid_input",
      "Sprout posting URL must be a credential-free HTTPS URL",
    );
  }
  return url.href;
}

function normalizedIsoDate(value: string | null | undefined): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function freshnessEligiblePostedAt(raw: SproutRawJob, now: Date): string | null {
  const postedAt = normalizedIsoDate(raw.postedAt);
  if (!postedAt) return null;
  const postedTime = new Date(postedAt).getTime();
  const updatedAt = normalizedIsoDate(raw.updatedAt);
  if (postedTime > now.getTime()) return null;
  if (updatedAt && postedTime > new Date(updatedAt).getTime()) return null;
  return postedAt;
}

function firstJobType(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (!Array.isArray(value)) return null;
  return value.find((entry): entry is string => typeof entry === "string") ?? null;
}

function normalizedSalaryBounds(raw: SproutRawJob): {
  salaryMin: number | null;
  salaryMax: number | null;
} {
  const salaryMin = raw.salaryMin ?? null;
  const salaryMax = raw.salaryMax ?? null;
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    return { salaryMin: salaryMax, salaryMax: salaryMin };
  }
  return { salaryMin, salaryMax };
}

export function tryNormalizeSproutJob(
  rawValue: SproutRawJob,
  now = new Date(),
): SproutNormalizationResult {
  const raw = sproutRawJobSchema.parse(rawValue);
  const locations = raw.locations.map(normalizeSproutLocation);
  const primary = primaryLocation(locations);
  if (!primary) {
    return { accepted: false, reason: "country_leak", externalId: raw.id };
  }

  let applyUrl: string;
  try {
    applyUrl = requireApplyUrl(raw.postingUrl);
  } catch (error) {
    return {
      accepted: false,
      reason: raw.postingUrl ? "invalid_apply_url" : "missing_apply_url",
      externalId: raw.id,
    };
  }
  const salary = normalizedSalaryBounds(raw);

  return {
    accepted: true,
    job: {
      envelope: {
        provider: SPROUT_PROVIDER,
        externalId: raw.id,
        payload: raw,
      },
      title: raw.title,
      company: raw.company,
      location: primary.display,
      countryCode: "FR",
      description: cleanText(raw.rawDescription) ?? cleanText(raw.summary) ?? "",
      contractType: firstJobType(raw.jobTypes),
      status: cleanText(raw.status),
      applyUrls: [applyUrl],
      city: primary.city,
      region: primary.region,
      remote: cleanText(raw.workLocation)?.toUpperCase() === "REMOTE",
      salaryMin: salary.salaryMin,
      salaryMax: salary.salaryMax,
      currency: cleanText(raw.currency)?.toUpperCase() ?? null,
      postedAt: freshnessEligiblePostedAt(raw, now),
      importedAt: normalizedIsoDate(raw.createdAt),
      lastSeenAt: normalizedIsoDate(raw.lastCheckedAt) ?? normalizedIsoDate(raw.updatedAt),
      allLocations: locations,
    },
  };
}

export function normalizeSproutJob(
  rawValue: SproutRawJob,
  now = new Date(),
): NormalizedSproutJob {
  const result = tryNormalizeSproutJob(rawValue, now);
  if (!result.accepted) {
    throw new IngestionError(
      "invalid_input",
      `Sprout job ${result.externalId} quarantined: ${result.reason}`,
    );
  }
  return result.job;
}
