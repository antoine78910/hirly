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
import {
  IngestionError,
  type SourceAdapter,
  type SourceContext,
} from "@hirly/ingestion";
import {
  fetchBoundedAtsJson,
  parseAtsTrialOptions,
  type AtsTrialTransportOptions,
  type BoundAtsTrialTransport,
} from "../ats-trial-transport";

const optionalText = z.string().trim().min(1).nullable().optional();

export const leverRawJobSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    text: z.string().trim().min(1).max(512),
    categories: z
      .object({
        location: optionalText,
        allLocations: z.array(z.string()).optional(),
        commitment: optionalText,
        team: optionalText,
        department: optionalText,
      })
      .passthrough()
      .default({}),
    country: z.string().length(2).nullable().optional(),
    descriptionPlain: z.string().max(100_000).default(""),
    additionalPlain: z.string().max(100_000).default(""),
    createdAt: z.number().int().nonnegative().nullable().optional(),
    hostedUrl: z.url(),
    applyUrl: z.url(),
    workplaceType: optionalText,
  })
  .passthrough();

export type LeverRawJob = z.output<typeof leverRawJobSchema>;

export type LeverTrialRegion = "global" | "eu";

// This is a fixture safety ceiling, not a claim about a vendor quota.
const rateLimit = { requestsPerMinute: 1, concurrency: 1 } as const;

function normalized(
  rawValue: LeverRawJob,
  tenantKey: string,
  fallbackCountryCode: string,
) {
  const raw = leverRawJobSchema.parse(rawValue);
  const allowedHosts = ["jobs.lever.co", "jobs.eu.lever.co"] as const;
  const hostedUrl = requireBoundAtsUrl({
    value: raw.hostedUrl,
    provider: "lever",
    allowedHosts,
    tenantKey,
    postingId: raw.id,
    pathKind: "lever_job",
  });
  const applyUrl = requireBoundAtsUrl({
    value: raw.applyUrl,
    provider: "lever",
    allowedHosts,
    tenantKey,
    postingId: raw.id,
    pathKind: "lever_apply",
  });
  if (new URL(hostedUrl).hostname !== new URL(applyUrl).hostname) {
    throw new IngestionError(
      "invalid_input",
      "Lever hosted and apply URLs must use the same regional host",
    );
  }
  const countryCode = raw.country?.toUpperCase() ?? fallbackCountryCode;
  const location =
    raw.categories.location ??
    raw.categories.allLocations?.join(", ") ??
    "Remote";
  const description = [raw.descriptionPlain, raw.additionalPlain]
    .filter(Boolean)
    .join("\n\n");
  return {
    envelope: {
      provider: "lever" as const,
      externalId: `${tenantKey}:${raw.id}`,
      payload: raw,
    },
    title: raw.text,
    company: tenantKey,
    location,
    countryCode,
    description,
    contractType: raw.categories.commitment ?? null,
    status: "published",
    // Preserve the existing Python canonical-row precedence. The occurrence
    // below records the direct application URL separately.
    applyUrls: [hostedUrl, applyUrl],
  };
}

export const leverProvider: ProviderCore<LeverRawJob> = {
  provider: "lever",
  authorizationStatus: "unverified",
  accessMethod: "fixture-only-public-postings-api",
  rateLimit,
  coreReady: true,
  liveTransportReady: false,
  shadowModeReady: false,
  canonicalWriteReady: false,
  activationRequirements: [
    "complete measured paid-user ranking with non-sample evidence",
    "record approved commercial redisplay and retention policy",
    "freeze global or EU tenant identity and pagination behavior",
    "replace the fixture safety ceiling with reviewed rate evidence",
    "assign exactly one TypeScript canonical writer",
    "enable only an approved tenant allowlist after shadow verification",
  ],
  adapter: {
    provider: "lever",
    normalizeRaw(raw) {
      const parsed = leverRawJobSchema.parse(raw);
      return normalized(parsed, routeTenant(parsed.hostedUrl), "ZZ");
    },
  },
  transport: new DisabledProviderTransport<LeverRawJob>("lever"),
};

class LeverFixtureSourceAdapter extends FixtureOnlyAtsSourceAdapter<LeverRawJob> {
  protected readonly documentationUrl =
    "https://github.com/lever/postings-api";

  normalize(rawValue: LeverRawJob, context: SourceContext) {
    const raw = leverRawJobSchema.parse(rawValue);
    const tenantKey =
      context.source.tenantKey ?? context.source.sourceKey;
    const countryCode = context.source.countryCodes[0] ?? "ZZ";
    const job = normalized(raw, tenantKey, countryCode);
    return {
      job,
      externalId: job.envelope.externalId,
      canonicalSourceUrl: job.applyUrls[0],
      canonicalApplyUrl: job.applyUrls[1],
      atsPostingId: raw.id,
    };
  }
}

function routeTenant(value: string): string {
  return new URL(value).pathname.split("/").filter(Boolean)[0] ?? "";
}

export function createLeverFixtureSourceAdapter(
  rows: readonly LeverRawJob[],
  fixturePolicyId: string,
): SourceAdapter<LeverRawJob, AtsFixtureCursor, AtsFixtureScope> {
  return new LeverFixtureSourceAdapter(
    "lever",
    rateLimit,
    rows,
    fixturePolicyId,
  );
}

export function createLeverTrialTransport(
  options: AtsTrialTransportOptions & { readonly region: LeverTrialRegion },
): BoundAtsTrialTransport & {
  readonly region: LeverTrialRegion;
  fetch(signal: AbortSignal): Promise<readonly LeverRawJob[]>;
} {
  const parsed = parseAtsTrialOptions(options);
  const host =
    options.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const url = new URL(
    `https://${host}/v0/postings/${encodeURIComponent(parsed.approvedTenantId)}`,
  );
  url.searchParams.set("mode", "json");
  return {
    trialOnly: true,
    manualInvocationOnly: true,
    liveTransportReady: false,
    canonicalWriteReady: false,
    credentialsAccepted: false,
    approvedTenantId: parsed.approvedTenantId,
    budgets: parsed.budgets,
    region: options.region,
    async fetch(signal) {
      return fetchBoundedAtsJson({
        url,
        allowedHost: host,
        fetch: parsed.fetch,
        budgets: parsed.budgets,
        schema: z.array(leverRawJobSchema),
        signal,
      });
    },
  };
}
