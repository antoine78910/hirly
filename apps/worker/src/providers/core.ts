import {
  type NormalizedProviderJob,
  type ProviderAdapter,
  type ProviderPage,
  type ProviderTransport,
  IngestionError,
} from "@hirly/ingestion";
import {
  type AuthorizationStatus,
  type Provider,
  type ProviderSearchRequest,
  type RateLimitConfig,
} from "@hirly/contracts";
import { z } from "zod";

export const fixtureProvenanceSchema = z
  .object({
    kind: z.literal("synthetic_sanitized"),
    approvalRef: z.literal(
      ".omx/plans/prd-nextjs-bun-foundation.md#phase-4",
    ),
    containsPersonalData: z.literal(false),
  })
  .strict();

const fixtureJobFields = {
  schemaVersion: z.literal("hirly.provider-fixture.v1"),
  provenance: fixtureProvenanceSchema,
  externalId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(512),
  company: z.string().trim().min(1).max(512),
  location: z.string().trim().min(1).max(512),
  countryCode: z.string().trim().min(2).max(64),
  description: z.string().max(100_000).default(""),
  contractType: z.string().trim().min(1).max(128).nullable().default(null),
  status: z.string().trim().min(1).max(64).nullable().default(null),
  applyUrls: z.array(z.url()).max(10).default([]),
  sourceDocument: z.record(z.string(), z.unknown()).default({}),
} as const;

export function createFixtureJobSchema<ProviderName extends Provider>(
  provider: ProviderName,
) {
  return z
    .object({
      provider: z.literal(provider),
      ...fixtureJobFields,
    })
    .strict();
}

export interface ProviderCore<RawJob> {
  provider: Provider;
  authorizationStatus: AuthorizationStatus;
  accessMethod: string;
  rateLimit: RateLimitConfig;
  coreReady: true;
  liveTransportReady: false;
  activationRequirements: readonly string[];
  adapter: ProviderAdapter<RawJob>;
  transport: ProviderTransport<RawJob>;
}

export class DisabledProviderTransport<RawJob>
  implements ProviderTransport<RawJob>
{
  constructor(readonly provider: Provider) {}

  async fetch(
    _request: ProviderSearchRequest,
    _signal: AbortSignal,
  ): Promise<ProviderPage<RawJob>> {
    throw new IngestionError(
      "authorization_blocked",
      `provider transport is disabled pending authorized access: ${this.provider}`,
    );
  }
}

export function defineProviderCore<
  ProviderName extends Provider,
  RawJob extends {
    provider: ProviderName;
    externalId: string;
    title: string;
    company: string;
    location: string;
    countryCode: string;
    description: string;
    contractType: string | null;
    status: string | null;
    applyUrls: string[];
  },
>(input: {
  provider: ProviderName;
  schema: z.ZodType<RawJob>;
  authorizationStatus: AuthorizationStatus;
  accessMethod: string;
  rateLimit: RateLimitConfig;
}): ProviderCore<RawJob> {
  return {
    provider: input.provider,
    authorizationStatus: input.authorizationStatus,
    accessMethod: input.accessMethod,
    rateLimit: input.rateLimit,
    coreReady: true,
    liveTransportReady: false,
    activationRequirements: [
      "record reviewed authorization evidence",
      "assign exactly one TypeScript canonical writer",
      "supply an authorized transport without changing normalization",
      "pass fixture, shadow, bounded canary, and canonical read-back checks",
      "enable persisted scheduling only after the canary passes",
    ],
    adapter: {
      provider: input.provider,
      normalizeRaw(raw): NormalizedProviderJob {
        const parsed = input.schema.parse(raw);
        return {
          envelope: {
            provider: input.provider,
            externalId: parsed.externalId,
            payload: JSON.parse(JSON.stringify(parsed)) as Record<
              string,
              unknown
            >,
          },
          title: parsed.title,
          company: parsed.company,
          location: parsed.location,
          countryCode: parsed.countryCode,
          description: parsed.description,
          contractType: parsed.contractType,
          status: parsed.status,
          applyUrls: parsed.applyUrls,
        };
      },
    },
    transport: new DisabledProviderTransport<RawJob>(input.provider),
  };
}
