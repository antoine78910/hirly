import { z } from "zod";
import {
  DisabledProviderTransport,
  type ProviderCore,
} from "../core";
import {
  FixtureOnlyAtsSourceAdapter,
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
const optionalUrl = z.url().nullable().optional();

export const recruiteeRawJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().trim().min(1).max(512),
    slug: optionalText,
    status: z.literal("published"),
    careers_url: optionalUrl,
    careers_apply_url: optionalUrl,
    description: z.string().max(100_000).default(""),
    location: optionalText,
    city: optionalText,
    country_code: z.string().trim().length(2).nullable().optional(),
    company_name: optionalText,
    department: optionalText,
    employment_type_code: optionalText,
    remote: z.boolean().nullable().optional(),
    published_at: z.iso.datetime({ offset: true }).nullable().optional(),
    created_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .passthrough();

export type RecruiteeRawJob = z.output<typeof recruiteeRawJobSchema>;

const recruiteeTrialResponseSchema = z
  .object({ offers: z.array(recruiteeRawJobSchema) })
  .passthrough();

// This is a fixture safety ceiling, not a claim about a vendor quota.
const rateLimit = { requestsPerMinute: 1, concurrency: 1 } as const;

function cleanText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, encoded: string) => {
      const codePoint = encoded.toLowerCase().startsWith("x")
        ? Number.parseInt(encoded.slice(1), 16)
        : Number.parseInt(encoded, 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function requireTenantKey(value: string): string {
  const tenantKey = value.trim().toLowerCase();
  if (
    tenantKey.length === 0 ||
    tenantKey.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(tenantKey) ||
    ["api", "app", "apply", "careers", "help", "jobs", "support", "www"].includes(
      tenantKey,
    )
  ) {
    throw new IngestionError(
      "invalid_input",
      "Recruitee tenant identifier failed the fixed-host policy",
    );
  }
  return tenantKey;
}

function requireBoundRecruiteeUrl(input: {
  value: string;
  tenantKey: string;
  slug: string;
}): string {
  const tenantKey = requireTenantKey(input.tenantKey);
  const url = new URL(input.value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    url.hostname.toLowerCase() !== `${tenantKey}.recruitee.com`
  ) {
    throw new IngestionError(
      "invalid_input",
      "Recruitee canonical URL failed transport or tenant policy",
    );
  }
  let parts: string[];
  try {
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part).toLowerCase());
  } catch {
    throw new IngestionError(
      "invalid_input",
      "Recruitee canonical URL contains an invalid encoded path",
    );
  }
  if (
    parts.length !== 2 ||
    parts[0] !== "o" ||
    parts[1] !== input.slug.toLowerCase()
  ) {
    throw new IngestionError(
      "invalid_input",
      "Recruitee canonical URL is not bound to the source tenant and offer",
    );
  }
  return url.href;
}

function normalized(
  rawValue: RecruiteeRawJob,
  tenantValue: string,
  fallbackCountryCode: string,
) {
  const raw = recruiteeRawJobSchema.parse(rawValue);
  const tenantKey = requireTenantKey(tenantValue);
  const slug = raw.slug ?? raw.id;
  const fallbackUrl = `https://${tenantKey}.recruitee.com/o/${encodeURIComponent(slug)}`;
  const candidateUrls = [raw.careers_url, raw.careers_apply_url].filter(
    (value): value is string => Boolean(value),
  );
  for (const value of candidateUrls) {
    requireBoundRecruiteeUrl({ value, tenantKey, slug });
  }
  const canonicalUrl = requireBoundRecruiteeUrl({
    value: raw.careers_url ?? raw.careers_apply_url ?? fallbackUrl,
    tenantKey,
    slug,
  });
  return {
    envelope: {
      provider: "recruitee" as const,
      externalId: `${tenantKey}:${raw.id}`,
      payload: raw,
    },
    title: cleanText(raw.title),
    company: cleanText(raw.company_name ?? tenantKey),
    location: cleanText(raw.location ?? raw.city ?? "France"),
    countryCode: raw.country_code?.toUpperCase() ?? fallbackCountryCode,
    description: cleanText(raw.description),
    contractType: raw.employment_type_code ?? null,
    status: raw.status,
    // Preserve current Python precedence: careers_url, then careers_apply_url.
    applyUrls: [canonicalUrl],
  };
}

export const recruiteeProvider: ProviderCore<RecruiteeRawJob> = {
  provider: "recruitee",
  authorizationStatus: "unverified",
  accessMethod: "fixture-only-public-offers-api",
  rateLimit,
  coreReady: true,
  liveTransportReady: false,
  shadowModeReady: false,
  canonicalWriteReady: false,
  activationRequirements: [
    "record approved commercial redisplay and retention policy",
    "verify sanitized tenant fixtures and complete-snapshot semantics",
    "reconcile identity, URL, country, fingerprint, and readiness with Python",
    "replace the fixture safety ceiling with reviewed rate evidence",
    "assign exactly one TypeScript canonical writer after shadow verification",
    "enable only an approved tenant and country allowlist",
  ],
  adapter: {
    provider: "recruitee",
    normalizeRaw(raw) {
      const parsed = recruiteeRawJobSchema.parse(raw);
      const selectedUrl = parsed.careers_url ?? parsed.careers_apply_url;
      if (!selectedUrl) {
        throw new IngestionError(
          "invalid_input",
          "Recruitee provider normalization requires a tenant-bound offer URL",
        );
      }
      return normalized(parsed, routeTenant(selectedUrl), "ZZ");
    },
  },
  transport: new DisabledProviderTransport<RecruiteeRawJob>("recruitee"),
};

class RecruiteeFixtureSourceAdapter extends FixtureOnlyAtsSourceAdapter<RecruiteeRawJob> {
  protected readonly documentationUrl =
    "https://docs.recruitee.com/reference/offers";

  normalize(rawValue: RecruiteeRawJob, context: SourceContext) {
    const raw = recruiteeRawJobSchema.parse(rawValue);
    const tenantKey = context.source.tenantKey ?? context.source.sourceKey;
    const fallbackCountryCode = context.source.countryCodes[0] ?? "ZZ";
    const job = normalized(raw, tenantKey, fallbackCountryCode);
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
  const host = new URL(value).hostname.toLowerCase();
  const suffix = ".recruitee.com";
  return host.endsWith(suffix) ? host.slice(0, -suffix.length) : "";
}

export function createRecruiteeFixtureSourceAdapter(
  rows: readonly RecruiteeRawJob[],
  fixturePolicyId: string,
): SourceAdapter<RecruiteeRawJob, AtsFixtureCursor, AtsFixtureScope> {
  return new RecruiteeFixtureSourceAdapter(
    "recruitee",
    rateLimit,
    rows,
    fixturePolicyId,
  );
}

export function createRecruiteeTrialTransport(
  options: AtsTrialTransportOptions,
): BoundAtsTrialTransport & {
  fetch(signal: AbortSignal): Promise<readonly RecruiteeRawJob[]>;
} {
  const parsed = parseAtsTrialOptions(options);
  const tenantKey = requireTenantKey(parsed.approvedTenantId);
  const host = `${tenantKey}.recruitee.com`;
  const url = new URL(`https://${host}/api/offers/`);
  url.searchParams.set("format", "json");
  return {
    trialOnly: true,
    manualInvocationOnly: true,
    liveTransportReady: false,
    canonicalWriteReady: false,
    credentialsAccepted: false,
    approvedTenantId: tenantKey,
    budgets: parsed.budgets,
    async fetch(signal) {
      const page = await fetchBoundedAtsJson({
        url,
        allowedHost: host,
        fetch: parsed.fetch,
        budgets: parsed.budgets,
        schema: recruiteeTrialResponseSchema,
        signal,
      });
      return page.offers;
    },
  };
}
