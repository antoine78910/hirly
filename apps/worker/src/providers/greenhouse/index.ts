import { z } from "zod";
import {
  DisabledProviderTransport,
  type ProviderCore,
} from "../core";
import {
  FixtureOnlyAtsSourceAdapter,
  requireBoundAtsUrl,
  type AtsFixtureCursor,
  type AtsFixtureScope,
} from "../ats-fixture";
import type { SourceAdapter, SourceContext } from "@hirly/ingestion";

const greenhouseIdSchema = z.union([z.string(), z.number()]).transform(String);

export const greenhouseRawJobSchema = z
  .object({
    id: greenhouseIdSchema,
    internal_job_id: z
      .union([z.string(), z.number()])
      .transform(String)
      .nullable()
      .optional(),
    title: z.string().trim().min(1).max(512),
    updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
    location: z
      .object({ name: z.string().trim().min(1).max(512) })
      .passthrough(),
    absolute_url: z.url(),
    content: z.string().max(100_000).default(""),
  })
  .passthrough();

export type GreenhouseRawJob = z.output<typeof greenhouseRawJobSchema>;

// This is a fixture safety ceiling, not a claim about a vendor quota.
const rateLimit = { requestsPerMinute: 1, concurrency: 1 } as const;

function normalized(
  rawValue: GreenhouseRawJob,
  tenantKey: string,
  countryCode: string,
) {
  const raw = greenhouseRawJobSchema.parse(rawValue);
  const absoluteUrl = requireBoundAtsUrl({
    value: raw.absolute_url,
    provider: "greenhouse",
    allowedHosts: [
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
    ],
    tenantKey,
    postingId: raw.id,
    pathKind: "greenhouse_job",
  });
  return {
    envelope: {
      provider: "greenhouse" as const,
      externalId: `${tenantKey}:${raw.id}`,
      payload: raw,
    },
    title: raw.title,
    company: tenantKey,
    location: raw.location.name,
    countryCode,
    description: raw.content,
    contractType: null,
    status: "published",
    applyUrls: [absoluteUrl],
  };
}

export const greenhouseProvider: ProviderCore<GreenhouseRawJob> = {
  provider: "greenhouse",
  authorizationStatus: "unverified",
  accessMethod: "fixture-only-public-job-board-api",
  rateLimit,
  coreReady: true,
  liveTransportReady: false,
  shadowModeReady: false,
  canonicalWriteReady: false,
  activationRequirements: [
    "complete measured paid-user ranking with non-sample evidence",
    "record approved commercial redisplay and retention policy",
    "verify a sanitized tenant fixture and complete-snapshot semantics",
    "replace the fixture safety ceiling with reviewed rate evidence",
    "assign exactly one TypeScript canonical writer",
    "enable only an approved tenant allowlist after shadow verification",
  ],
  adapter: {
    provider: "greenhouse",
    normalizeRaw(raw) {
      const parsed = greenhouseRawJobSchema.parse(raw);
      return normalized(parsed, routeTenant(parsed.absolute_url), "ZZ");
    },
  },
  transport: new DisabledProviderTransport<GreenhouseRawJob>("greenhouse"),
};

class GreenhouseFixtureSourceAdapter extends FixtureOnlyAtsSourceAdapter<GreenhouseRawJob> {
  protected readonly documentationUrl =
    "https://developer.greenhouse.io/job-board.html";

  normalize(rawValue: GreenhouseRawJob, context: SourceContext) {
    const raw = greenhouseRawJobSchema.parse(rawValue);
    const tenantKey =
      context.source.tenantKey ?? context.source.sourceKey;
    const countryCode = context.source.countryCodes[0] ?? "ZZ";
    const job = normalized(raw, tenantKey, countryCode);
    return {
      job,
      externalId: job.envelope.externalId,
      canonicalSourceUrl: job.applyUrls[0],
      canonicalApplyUrl: job.applyUrls[0],
      atsPostingId: raw.id,
    };
  }
}

function routeTenant(value: string): string {
  return new URL(value).pathname.split("/").filter(Boolean)[0] ?? "";
}

export function createGreenhouseFixtureSourceAdapter(
  rows: readonly GreenhouseRawJob[],
  fixturePolicyId: string,
): SourceAdapter<GreenhouseRawJob, AtsFixtureCursor, AtsFixtureScope> {
  return new GreenhouseFixtureSourceAdapter(
    "greenhouse",
    rateLimit,
    rows,
    fixturePolicyId,
  );
}
