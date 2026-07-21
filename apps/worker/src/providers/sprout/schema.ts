import { z } from "zod";

const optionalText = z.string().trim().max(100_000).nullable().optional();
const optionalShortText = z.string().trim().max(1_024).nullable().optional();
const optionalNumber = z.number().finite().nullable().optional();

const boundedJsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string().max(100_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(boundedJsonValueSchema).max(500),
    z.record(z.string().max(256), boundedJsonValueSchema).superRefine(
      (value, context) => {
        if (Object.keys(value).length > 500) {
          context.addIssue({
            code: "custom",
            message: "Sprout object exceeds the 500-key safety bound",
          });
        }
      },
    ),
  ]),
);

const optionalBoundedValue = boundedJsonValueSchema.nullable().optional();
const sproutIdSchema = z.union([
  z.string().trim().min(1).max(512),
  z.number().int().nonnegative(),
]).transform(String);
const optionalSproutSourceIdSchema = z
  .union([
    z.string().trim().min(1).max(512),
    z.number().int().nonnegative(),
  ])
  .nullable()
  .optional();

export const sproutCoordinatesSchema = z.union([
  z
    .object({
      latitude: optionalNumber,
      longitude: optionalNumber,
    })
    .strict(),
  z.tuple([z.number().finite(), z.number().finite()]),
]);

export const sproutLocationSchema = z
  .object({
    id: optionalSproutSourceIdSchema,
    jobId: optionalSproutSourceIdSchema,
    createdAt: optionalShortText,
    address: optionalShortText,
    country: optionalShortText,
    countryCode: optionalShortText,
    city: optionalShortText,
    region: optionalShortText,
    state: optionalShortText,
    stateCode: optionalShortText,
    code: optionalShortText,
    latitude: optionalNumber,
    longitude: optionalNumber,
    coordinates: sproutCoordinatesSchema.nullable().optional(),
  })
  .strict();

export const sproutJobTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "INTERNSHIP",
]);
export const sproutExperienceLevelSchema = z.enum([
  "ENTRY",
  "MID",
  "SENIOR",
  "EXECUTIVE",
]);
export const sproutWorkLocationSchema = z.enum([
  "IN_PERSON",
  "HYBRID",
  "REMOTE",
]);
export const sproutPostedDateSchema = z.enum(["any", "24h", "30d"]);

/**
 * This schema is deliberately strict. Every field observed during the bounded
 * qualification is listed here so a new upstream field becomes schema-drift
 * telemetry instead of silently entering the retained source document.
 */
export const sproutRawJobSchema = z
  .object({
    id: sproutIdSchema,
    company: z.string().trim().min(1).max(1_024),
    title: z.string().trim().min(1).max(1_024),
    summary: optionalText,
    rawDescription: optionalText,
    createdAt: optionalShortText,
    updatedAt: optionalShortText,
    lastCheckedAt: optionalShortText,
    postedAt: optionalShortText,
    salaryMin: optionalNumber,
    salaryMax: optionalNumber,
    currency: optionalShortText,
    status: optionalShortText,
    workLocation: optionalShortText,
    postingUrl: optionalShortText,
    source: optionalShortText,
    sourceId: optionalSproutSourceIdSchema,
    desiredQualifications: optionalBoundedValue,
    requiredQualifications: optionalBoundedValue,
    restrictions: optionalBoundedValue,
    educationLevel: optionalBoundedValue,
    h1b: optionalBoundedValue,
    industry: optionalBoundedValue,
    jobLevel: optionalBoundedValue,
    jobTypes: optionalBoundedValue,
    relocationAssistance: optionalBoundedValue,
    companyLogo: optionalShortText,
    companySize: optionalBoundedValue,
    oneLiner: optionalText,
    checkedBy: optionalBoundedValue,
    soc: optionalBoundedValue,
    socCode: optionalShortText,
    socTitle: optionalShortText,
    socMajorGroup: optionalShortText,
    socMinorGroup: optionalShortText,
    socBroadOccupation: optionalShortText,
    socDetailedOccupation: optionalShortText,
    onet: optionalBoundedValue,
    onetCode: optionalShortText,
    onetTitle: optionalShortText,
    minExperience: optionalBoundedValue,
    benefits: optionalBoundedValue,
    responsibilities: optionalBoundedValue,
    skills: optionalBoundedValue,
    schedule: optionalBoundedValue,
    employerId: optionalBoundedValue,
    companyId: optionalBoundedValue,
    locations: z.array(sproutLocationSchema).max(100),
  })
  .strict();

export type SproutLocation = z.output<typeof sproutLocationSchema>;
export type SproutRawJob = z.output<typeof sproutRawJobSchema>;

export const sproutResponseSchema = z
  .object({
    message: z.string().max(10_000).nullable().optional(),
    jobs: z.array(sproutRawJobSchema).max(500),
    results: z.array(sproutRawJobSchema).max(500).optional(),
    count: z.number().int().nonnegative(),
    next: z.string().max(4_096).nullable(),
    previous: z.string().max(4_096).nullable(),
  })
  .strict();

export type SproutResponse = z.output<typeof sproutResponseSchema>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface ParsedSproutResponse {
  jobs: SproutRawJob[];
  count: number;
  next: string | null;
  previous: string | null;
  wrapperMismatch: boolean;
}

/** Consume the authoritative `jobs` collection exactly once. */
export function parseSproutResponse(value: unknown): ParsedSproutResponse {
  const response = sproutResponseSchema.parse(value);
  return {
    jobs: response.jobs,
    count: response.count,
    next: response.next,
    previous: response.previous,
    wrapperMismatch:
      response.results !== undefined &&
      stableJson(response.jobs) !== stableJson(response.results),
  };
}
