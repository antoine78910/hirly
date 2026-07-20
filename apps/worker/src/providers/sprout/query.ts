import { IngestionError } from "@hirly/ingestion";

export const SPROUT_FRANCE_LOCATION = {
  address: "France",
  countryCode: "FR",
  isCountry: true,
  latitude: 47.1106,
  longitude: 2.7834,
  radius: 50,
} as const;

export interface SproutFranceQueryOptions {
  offset?: number;
  limit?: number;
  /** Keep false until the bounded qualification proves country containment. */
  includeUnknownWorkLocation?: boolean;
  /** Preserve the qualified request shape until radius equivalence is proven. */
  includeQualifiedRadius?: boolean;
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new IngestionError(
      "invalid_input",
      `Sprout ${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

export function buildSproutFranceQuery(
  options: SproutFranceQueryOptions = {},
): URLSearchParams {
  const offset = boundedInteger(options.offset ?? 0, "offset", 0, 10_000_000);
  const limit = boundedInteger(options.limit ?? 10, "limit", 1, 500);
  const location = SPROUT_FRANCE_LOCATION;
  const query = new URLSearchParams();

  query.set("location[address]", location.address);
  query.set("location[countryCode]", location.countryCode);
  query.set("location[isCountry]", String(location.isCountry));
  query.set("location[latitude]", String(location.latitude));
  query.set("location[longitude]", String(location.longitude));
  if (options.includeQualifiedRadius !== false) {
    query.set("location[radius]", String(location.radius));
  }
  query.set("postedDate", "any");
  query.set("includeUnknownSalaryRange", "true");
  query.set(
    "includeUnknownWorkLocation",
    String(options.includeUnknownWorkLocation ?? false),
  );
  query.set("offset", String(offset));
  query.set("limit", String(limit));

  return query;
}

function extractOffset(candidate: string): number | null {
  if (/^\d+$/.test(candidate)) return Number(candidate);
  if (!candidate.startsWith("?") || candidate.includes("#")) return null;
  const values = new URLSearchParams(candidate.slice(1)).getAll("offset");
  if (values.length !== 1 || !/^\d+$/.test(values[0] ?? "")) return null;
  return Number(values[0]);
}

/**
 * Extract a checkpoint only; callers must rebuild the next request from the
 * approved query and must never follow the provider-supplied link.
 */
export function parseSproutNextOffset(input: {
  next: string | null;
  currentOffset: number;
  returnedItemCount: number;
  seenOffsets?: ReadonlySet<number>;
}): number | null {
  const currentOffset = boundedInteger(
    input.currentOffset,
    "current offset",
    0,
    10_000_000,
  );
  const returnedItemCount = boundedInteger(
    input.returnedItemCount,
    "returned item count",
    0,
    500,
  );
  if (input.next === null) return null;

  const offset = extractOffset(input.next.trim());
  const expectedOffset = currentOffset + returnedItemCount;
  if (
    offset === null ||
    !Number.isSafeInteger(offset) ||
    offset <= currentOffset ||
    offset !== expectedOffset ||
    input.seenOffsets?.has(offset)
  ) {
    throw new IngestionError(
      "integrity_error",
      "Sprout next offset is invalid, repeated, or non-monotonic",
    );
  }
  return offset;
}
