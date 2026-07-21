import type { Provider } from "@hirly/contracts";
import {
  DisabledProviderTransport,
  type ProviderCore,
} from "../core";
import { normalizeSproutJob } from "./normalization";
import type { SproutRawJob } from "./schema";

export * from "./normalization";
export * from "./query";
export * from "./qualification";
export * from "./schema";
export * from "./checkpoint";
export * from "./commit";
export * from "./registration";
export * from "./runtime";
export * from "./transport";

const SPROUT_PROVIDER = "sprout" as Provider;

export const sproutProvider: ProviderCore<SproutRawJob> = {
  provider: SPROUT_PROVIDER,
  authorizationStatus: "unverified",
  accessMethod: "disabled-authenticated-api",
  // Sprout permits at most one request every ten seconds.
  rateLimit: { requestsPerMinute: 6, concurrency: 1 },
  coreReady: true,
  liveTransportReady: false,
  shadowModeReady: false,
  canonicalWriteReady: false,
  activationRequirements: [
    "rotate discovery credentials and record reviewed Sprout authorization",
    "seal sanitized fixtures and qualified France query semantics",
    "configure an allowlisted HTTPS origin and secret reference",
    "assign exactly one TypeScript canonical writer",
    "pass bounded shadow, canary read-back, and rollback checks",
  ],
  adapter: {
    provider: SPROUT_PROVIDER,
    normalizeRaw(raw) {
      return normalizeSproutJob(raw);
    },
  },
  transport: new DisabledProviderTransport<SproutRawJob>(SPROUT_PROVIDER),
};
