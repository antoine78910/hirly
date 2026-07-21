import { IngestionError } from "@hirly/ingestion";
import { sproutCountry, type SproutCountryCode } from "./countries";

export interface SproutCountryQueryOptions {
  offset?: number;
  limit?: number;
  /** Include location-unknown rows; the canonical country guard discards them. */
  includeUnknownWorkLocation?: boolean;
}

export type SproutFranceQueryOptions = SproutCountryQueryOptions;

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new IngestionError("invalid_input", `Sprout ${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

/**
 * Sprout rejects its undocumented country-location parameter shape with 422.
 * Keep the upstream request entirely broad and enforce the country boundary
 * only after normalization, before the canonical source writer is called.
 * All optional employment, experience, salary, date, work-location, and
 * radius filters are deliberately omitted.
 */
export function buildSproutCountryQuery(
  countryCode: SproutCountryCode | string,
  options: SproutCountryQueryOptions = {},
): URLSearchParams {
  const offset = boundedInteger(options.offset ?? 0, "offset", 0, 10_000_000);
  const limit = boundedInteger(options.limit ?? 10, "limit", 1, 500);
  // Validate the source lane even though Sprout does not accept a country
  // filter in this endpoint's public request contract.
  sproutCountry(countryCode);
  const query = new URLSearchParams();
  query.set("jobTitle", "");
  query.set("jobCategory", "");
  query.set("minimumSalary", "0");
  query.set("postedDate", "any");
  query.set("includeUnknownSalaryRange", "true");
  query.set("includeUnknownWorkLocation", String(options.includeUnknownWorkLocation ?? true));
  query.set("additionalRequirements", "[]");
  query.set("offset", String(offset));
  query.set("limit", String(limit));
  return query;
}

export function buildSproutFranceQuery(options: SproutFranceQueryOptions = {}): URLSearchParams {
  return buildSproutCountryQuery("FR", options);
}

function extractOffset(candidate: string): number | null {
  if (/^\d+$/.test(candidate)) return Number(candidate);
  if (!candidate.startsWith("?") || candidate.includes("#")) return null;
  const values = new URLSearchParams(candidate.slice(1)).getAll("offset");
  if (values.length !== 1 || !/^\d+$/.test(values[0] ?? "")) return null;
  return Number(values[0]);
}

export function parseSproutNextOffset(input: { next: string | null; currentOffset: number; returnedItemCount: number; seenOffsets?: ReadonlySet<number> }): number | null {
  const currentOffset = boundedInteger(input.currentOffset, "current offset", 0, 10_000_000);
  const returnedItemCount = boundedInteger(input.returnedItemCount, "returned item count", 0, 500);
  if (input.next === null) return null;
  const offset = extractOffset(input.next.trim());
  const expectedOffset = currentOffset + returnedItemCount;
  if (offset === null || !Number.isSafeInteger(offset) || offset <= currentOffset || offset !== expectedOffset || input.seenOffsets?.has(offset)) {
    throw new IngestionError("integrity_error", "Sprout next offset is invalid, repeated, or non-monotonic");
  }
  return offset;
}
