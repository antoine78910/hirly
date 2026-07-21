import { z } from "zod";
import {
  IngestionError,
  type SourceAdapter,
  type SourceContext,
} from "@hirly/ingestion";
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
  AtsTrialTransportError,
  fetchBoundedAtsJson,
  type AtsTrialFetch,
  type AtsTrialTransportBudgets,
  type BoundAtsTrialTransport,
} from "../ats-trial-transport";
import { approveAtsInventoryShadowScope } from "../ats-inventory-readiness";

const nicokaIdSchema = z.union([z.string(), z.number()]).transform(String);
const optionalText = z.string().trim().max(100_000).nullable().optional();
const tenantSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9_-]*$/i);

export const nicokaRawJobSchema = z
  .object({
    id: nicokaIdSchema,
    jobid: nicokaIdSchema.optional(),
    uid: z.string().trim().min(1).max(512),
    label: z.string().trim().min(1).max(512),
    oLabel: z.string().trim().min(1).max(512).nullable().optional(),
    description: optionalText,
    requirements: optionalText,
    benefits: optionalText,
    city: z.string().trim().max(256).nullable().optional(),
    address_state: z.string().trim().max(256).nullable().optional(),
    country: z.string().trim().length(2).nullable().optional(),
    contract_type: z.union([z.string(), z.number()]).nullable().optional(),
    published: z.literal(1),
    active: z.literal(1).nullable().optional(),
    applicationUrl: z.url(),
    published_on: optionalText,
    udate: optionalText,
  })
  .passthrough()
  .superRefine((raw, context) => {
    if (raw.jobid !== undefined && raw.jobid !== raw.id) {
      context.addIssue({
        code: "custom",
        message: "Nicoka id and jobid must identify the same posting",
        path: ["jobid"],
      });
    }
  });

export type NicokaRawJob = z.output<typeof nicokaRawJobSchema>;

export const nicokaPageSchema = z
  .object({
    queryUid: z.string().trim().min(1).max(512),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative().max(200),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    data: z.array(nicokaRawJobSchema).max(200),
  })
  .strict();

export type NicokaPage = z.output<typeof nicokaPageSchema>;
export type NicokaEnvironment = "production" | "trial";

// This remains deliberately below the documented four-request-per-second
// ceiling until tenant-specific rate evidence is reviewed.
const rateLimit = { requestsPerMinute: 60, concurrency: 1 } as const;

function normalizeCountry(value: string | null | undefined, fallback: string) {
  const countryCode = value?.toUpperCase() ?? fallback.toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new IngestionError(
      "invalid_input",
      "Nicoka country must be an ISO alpha-2 code",
    );
  }
  return countryCode;
}

function nicokaTenantFromApplyUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "trial.nicoka.com") {
    return decodePath(url)[0] ?? "";
  }
  const suffix = ".nicoka.com";
  return url.hostname.endsWith(suffix)
    ? url.hostname.slice(0, -suffix.length)
    : "";
}

function decodePath(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      throw new IngestionError(
        "invalid_input",
        "Nicoka canonical URL contains an invalid encoded path",
      );
    }
  });
}

function requireNicokaApplyUrl(
  value: string,
  tenantKey: string,
  postingUid: string,
): string {
  const url = new URL(value);
  const tenant = tenantKey.toLowerCase();
  const parts = decodePath(url).map((part) => part.toLowerCase());
  const productionHost = `${tenant}.nicoka.com`;
  const expectedPath =
    url.hostname === "trial.nicoka.com"
      ? [tenant, "public", "jobs", postingUid.toLowerCase(), "apply"]
      : ["public", "jobs", postingUid.toLowerCase(), "apply"];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash ||
    url.search ||
    ![productionHost, "trial.nicoka.com"].includes(url.hostname.toLowerCase()) ||
    parts.length !== expectedPath.length ||
    parts.some((part, index) => part !== expectedPath[index])
  ) {
    throw new IngestionError(
      "invalid_input",
      "Nicoka apply URL is not bound to the source tenant and posting",
    );
  }
  return url.href;
}

function sourceUrl(tenantKey: string, postingId: string): string {
  const parsedTenantKey = tenantSchema.parse(tenantKey).toLowerCase();
  const url = new URL(
    `https://${parsedTenantKey}.nicoka.com/api/jobs/published`,
  );
  url.searchParams.set("jobid", postingId);
  return url.href;
}

function normalized(
  rawValue: NicokaRawJob,
  tenantKey: string,
  fallbackCountryCode: string,
) {
  const raw = nicokaRawJobSchema.parse(rawValue);
  const parsedTenantKey = tenantSchema.parse(tenantKey).toLowerCase();
  const postingId = raw.id;
  const canonicalApplyUrl = requireNicokaApplyUrl(
    raw.applicationUrl,
    parsedTenantKey,
    raw.uid,
  );
  const description = [raw.description, raw.requirements, raw.benefits]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const location = [raw.city, raw.address_state]
    .filter((value): value is string => Boolean(value))
    .join(", ") || "Remote";
  return {
    envelope: {
      provider: "nicoka" as const,
      externalId: `${parsedTenantKey}:${postingId}`,
      payload: raw,
    },
    title: raw.label,
    company: parsedTenantKey,
    location,
    countryCode: normalizeCountry(raw.country, fallbackCountryCode),
    description,
    contractType:
      raw.contract_type === null || raw.contract_type === undefined
        ? null
        : String(raw.contract_type),
    status: "published",
    applyUrls: [canonicalApplyUrl],
  };
}

export const nicokaProvider: ProviderCore<NicokaRawJob> = {
  provider: "nicoka",
  authorizationStatus: "unverified",
  accessMethod: "disabled-public-published-jobs-api",
  rateLimit,
  coreReady: true,
  liveTransportReady: false,
  shadowModeReady: true,
  canonicalWriteReady: false,
  activationRequirements: [
    "record tenant-specific inventory access and redisplay approval",
    "seal a sanitized official fixture and repeated complete-snapshot evidence",
    "prove pagination totals and no-expiry-on-failure behavior",
    "assign exactly one TypeScript canonical writer",
    "enable only an approved tenant and country allowlist after shadow verification",
  ],
  adapter: {
    provider: "nicoka",
    normalizeRaw(raw) {
      const parsed = nicokaRawJobSchema.parse(raw);
      return normalized(
        parsed,
        nicokaTenantFromApplyUrl(parsed.applicationUrl),
        "ZZ",
      );
    },
  },
  transport: new DisabledProviderTransport<NicokaRawJob>("nicoka"),
};

class NicokaFixtureSourceAdapter extends FixtureOnlyAtsSourceAdapter<NicokaRawJob> {
  protected readonly documentationUrl = "https://api.nicoka.com/page_ATS/";

  normalize(rawValue: NicokaRawJob, context: SourceContext) {
    const raw = nicokaRawJobSchema.parse(rawValue);
    const tenantKey = context.source.tenantKey ?? context.source.sourceKey;
    const countryCode = context.source.countryCodes[0] ?? "ZZ";
    const job = normalized(raw, tenantKey, countryCode);
    return {
      job,
      externalId: job.envelope.externalId,
      canonicalSourceUrl: sourceUrl(tenantKey, raw.id),
      canonicalApplyUrl: job.applyUrls[0],
      atsPostingId: raw.id,
    };
  }
}

export function createNicokaFixtureSourceAdapter(
  rows: readonly NicokaRawJob[],
  fixturePolicyId: string,
): SourceAdapter<NicokaRawJob, AtsFixtureCursor, AtsFixtureScope> {
  return new NicokaFixtureSourceAdapter(
    "nicoka",
    rateLimit,
    rows,
    fixturePolicyId,
  );
}

export interface NicokaShadowBudgets {
  readonly maxPages: number;
  readonly maxBytesPerPage: number;
  readonly timeoutMsPerPage: number;
}

export interface NicokaShadowOptions {
  readonly approvedTenantId: string;
  readonly environment: NicokaEnvironment;
  readonly fetch?: AtsTrialFetch;
  readonly budgets?: Partial<NicokaShadowBudgets>;
}

export function createNicokaShadowTransport(options: NicokaShadowOptions):
  BoundAtsTrialTransport & {
    readonly shadowOnly: true;
    readonly environment: NicokaEnvironment;
    fetch(signal: AbortSignal): Promise<readonly NicokaRawJob[]>;
  } {
  const approvedTenantId = tenantSchema.parse(options.approvedTenantId).toLowerCase();
  const budgets = z.object({
    maxPages: z.number().int().positive().max(20),
    maxBytesPerPage: z.number().int().positive().max(10_000_000),
    timeoutMsPerPage: z.number().int().positive().max(60_000),
  }).strict().parse({
    maxPages: 10,
    maxBytesPerPage: 2_000_000,
    timeoutMsPerPage: 10_000,
    ...options.budgets,
  });
  const fetch = options.fetch ?? globalThis.fetch;
  const host = options.environment === "trial"
    ? "trial.nicoka.com"
    : `${approvedTenantId.toLowerCase()}.nicoka.com`;
  const basePath = options.environment === "trial"
    ? `/${encodeURIComponent(approvedTenantId)}/api/jobs/published`
    : "/api/jobs/published";
  const perPageBudgets: AtsTrialTransportBudgets = {
    maxRequests: 1,
    maxPages: 1,
    maxBytes: budgets.maxBytesPerPage,
    timeoutMs: budgets.timeoutMsPerPage,
  };
  return {
    trialOnly: true,
    shadowOnly: true,
    manualInvocationOnly: true,
    liveTransportReady: false,
    canonicalWriteReady: false,
    credentialsAccepted: false,
    approvedTenantId,
    budgets: perPageBudgets,
    environment: options.environment,
    async fetch(signal) {
      const rows: NicokaRawJob[] = [];
      const seen = new Set<string>();
      let expectedPages: number | null = null;
      let expectedTotal: number | null = null;
      for (let pageNumber = 1; ; pageNumber += 1) {
        if (pageNumber > budgets.maxPages) {
          throw new AtsTrialTransportError(
            "budget_exceeded",
            "Nicoka shadow response exceeds its page budget",
          );
        }
        const url = new URL(`https://${host}${basePath}`);
        url.searchParams.set("page", String(pageNumber));
        const page = await fetchBoundedAtsJson({
          url,
          allowedHost: host,
          fetch,
          budgets: perPageBudgets,
          schema: nicokaPageSchema,
          signal,
        });
        if (
          page.page !== pageNumber ||
          page.offset !== rows.length ||
          (expectedPages !== null && page.pages !== expectedPages) ||
          (expectedTotal !== null && page.total !== expectedTotal) ||
          page.offset + page.data.length > page.total
        ) {
          throw new AtsTrialTransportError(
            "malformed",
            "Nicoka pagination metadata did not reconcile",
          );
        }
        expectedPages ??= page.pages;
        expectedTotal ??= page.total;
        for (const row of page.data) {
          const externalId = `${approvedTenantId}:${row.id}`;
          if (seen.has(externalId)) {
            throw new AtsTrialTransportError(
              "malformed",
              "Nicoka shadow response repeated a posting identity",
            );
          }
          seen.add(externalId);
          rows.push(row);
        }
        if (pageNumber === page.pages) break;
      }
      if (rows.length !== expectedTotal) {
        throw new AtsTrialTransportError(
          "malformed",
          "Nicoka shadow response total did not reconcile",
        );
      }
      return rows;
    },
  };
}

export function createApprovedNicokaShadowTransport(options: NicokaShadowOptions & {
  readonly countryCode: string;
  readonly policy: unknown;
  readonly now?: Date;
}) {
  const approval = approveAtsInventoryShadowScope({
    policy: options.policy,
    provider: "nicoka",
    approvedTenantId: options.approvedTenantId,
    countryCode: options.countryCode,
    now: options.now,
  });
  return {
    ...createNicokaShadowTransport({
      approvedTenantId: approval.approvedTenantId,
      environment: options.environment,
      fetch: options.fetch,
      budgets: options.budgets,
    }),
    productionShadowApproved: true as const,
    policyId: approval.policy.policyId,
    policyDigest: approval.policyDigest,
    countryCode: approval.countryCode,
  };
}
