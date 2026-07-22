import capabilityCatalogue from "./application-capabilities.json";

export const ATS_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "personio",
  "smartrecruiters",
  "teamtailor",
  "flatchr",
  "nicoka",
  "workday",
  "icims",
  "taleez",
  "werecruit",
  "digitalrecruiters",
  "jobaffinity",
  "bamboohr",
  "successfactors",
  "breezyhr",
] as const;

export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export interface ApplicationCapability {
  urlDetection: boolean;
  inventoryConnector: boolean;
  tenantExtraction: boolean;
  driverRegistered: boolean;
  queuePermitted: boolean;
  noSubmitVerified: boolean;
}

export const APPLICATION_CAPABILITY_SCHEMA_VERSION = "hirly.application-capabilities.v1" as const;

if (capabilityCatalogue.schemaVersion !== APPLICATION_CAPABILITY_SCHEMA_VERSION) {
  throw new Error("application capability catalogue version mismatch");
}

export const APPLICATION_CAPABILITIES = capabilityCatalogue.providers as Readonly<
  Record<AtsProvider, ApplicationCapability>
>;

const catalogueProviders = Object.keys(APPLICATION_CAPABILITIES);
if (
  catalogueProviders.length !== ATS_PROVIDERS.length ||
  ATS_PROVIDERS.some((provider) => !APPLICATION_CAPABILITIES[provider])
) {
  throw new Error("application capability catalogue does not cover every ATS provider");
}

export function isStrictAutoApplicableProvider(
  provider: string | null | undefined,
): provider is AtsProvider {
  if (!provider || !ATS_PROVIDERS.includes(provider as AtsProvider)) return false;
  const capability = APPLICATION_CAPABILITIES[provider as AtsProvider];
  return capability.driverRegistered && capability.queuePermitted && capability.noSubmitVerified;
}

export const ATS_PROVIDER_HOST_PATTERNS: Readonly<Record<AtsProvider, readonly string[]>> = {
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io", "greenhouse.io"],
  lever: ["jobs.lever.co", "jobs.eu.lever.co", "api.lever.co", "api.eu.lever.co"],
  ashby: ["jobs.ashbyhq.com", "ashbyhq.com"],
  workable: ["apply.workable.com", "workable.com"],
  recruitee: ["*.recruitee.com", "recruitee.com"],
  personio: ["*.jobs.personio.com", "*.jobs.personio.de", "personio.com"],
  smartrecruiters: [
    "jobs.smartrecruiters.com",
    "careers.smartrecruiters.com",
    "smartrecruiters.com",
  ],
  teamtailor: ["*.teamtailor.com", "teamtailor.com"],
  flatchr: ["careers.flatchr.io", "flatchr.io"],
  nicoka: ["*.nicoka.com", "trial.nicoka.com/{tenant}"],
  workday: ["*.myworkdayjobs.com", "myworkdayjobs.com"],
  icims: ["*.icims.com", "icims.com"],
  taleez: ["*.taleez.com", "taleez.com"],
  werecruit: ["*.werecruit.io", "werecruit.io"],
  digitalrecruiters: ["*.digitalrecruiters.com", "digitalrecruiters.com"],
  jobaffinity: ["*.jobaffinity.fr", "jobaffinity.fr"],
  bamboohr: ["*.bamboohr.com", "bamboohr.com", "applytojob.com"],
  successfactors: ["*.successfactors.com", "successfactors.com", "jobs.sap.com"],
  breezyhr: ["*.breezy.hr", "breezy.hr"],
};

export interface AtsUrlClassification {
  originalUrl: string;
  provider: AtsProvider | null;
  tenantKey: string | null;
  boardKey: string | null;
  postingId: string | null;
  match: "tenant" | "provider_only" | "unknown" | "invalid_url";
}

/**
 * Evidence retained for a destination that looks like an ATS but is not in the
 * managed application catalogue. `providerHint` is deliberately not promoted
 * to `ats_provider`: that column participates in fulfilment and must only hold
 * providers whose capabilities we have reviewed.
 */
export interface AtsDetectionEvidence {
  status: "catalogued" | "unmanaged" | "unclassified" | "invalid_url" | "no_apply_url";
  host: string | null;
  provider: AtsProvider | null;
  providerHint: string | null;
  match: AtsUrlClassification["match"] | null;
}

const EXACT_HOST_PROVIDERS = new Map<string, AtsProvider>([
  ["boards.greenhouse.io", "greenhouse"],
  ["job-boards.greenhouse.io", "greenhouse"],
  ["greenhouse.io", "greenhouse"],
  ["jobs.lever.co", "lever"],
  ["jobs.eu.lever.co", "lever"],
  ["api.lever.co", "lever"],
  ["api.eu.lever.co", "lever"],
  ["jobs.ashbyhq.com", "ashby"],
  ["ashbyhq.com", "ashby"],
  ["apply.workable.com", "workable"],
  ["workable.com", "workable"],
  ["jobs.smartrecruiters.com", "smartrecruiters"],
  ["careers.smartrecruiters.com", "smartrecruiters"],
  ["smartrecruiters.com", "smartrecruiters"],
  ["jobs.personio.com", "personio"],
  ["jobs.personio.de", "personio"],
  ["careers.flatchr.io", "flatchr"],
  ["flatchr.io", "flatchr"],
  ["jobs.sap.com", "successfactors"],
  ["applytojob.com", "bamboohr"],
  ["grnh.se", "greenhouse"],
]);

const SUFFIX_HOST_PROVIDERS: ReadonlyArray<readonly [suffix: string, provider: AtsProvider]> = [
  [".greenhouse.io", "greenhouse"],
  [".ashbyhq.com", "ashby"],
  [".workable.com", "workable"],
  [".smartrecruiters.com", "smartrecruiters"],
  [".flatchr.io", "flatchr"],
  [".jobs.personio.com", "personio"],
  [".jobs.personio.de", "personio"],
  [".recruitee.com", "recruitee"],
  [".teamtailor.com", "teamtailor"],
  [".nicoka.com", "nicoka"],
  [".myworkdayjobs.com", "workday"],
  [".icims.com", "icims"],
  [".taleez.com", "taleez"],
  [".werecruit.io", "werecruit"],
  [".digitalrecruiters.com", "digitalrecruiters"],
  [".jobaffinity.fr", "jobaffinity"],
  [".bamboohr.com", "bamboohr"],
  [".applytojob.com", "bamboohr"],
  [".successfactors.com", "successfactors"],
  [".breezy.hr", "breezyhr"],
];

const BASE_HOST_PROVIDERS = new Map<string, AtsProvider>([
  ["recruitee.com", "recruitee"],
  ["personio.com", "personio"],
  ["teamtailor.com", "teamtailor"],
  ["nicoka.com", "nicoka"],
  ["myworkdayjobs.com", "workday"],
  ["icims.com", "icims"],
  ["taleez.com", "taleez"],
  ["werecruit.io", "werecruit"],
  ["digitalrecruiters.com", "digitalrecruiters"],
  ["jobaffinity.fr", "jobaffinity"],
  ["bamboohr.com", "bamboohr"],
  ["successfactors.com", "successfactors"],
  ["breezy.hr", "breezyhr"],
]);

const RESERVED_TENANTS = new Set([
  "api",
  "app",
  "apply",
  "boards",
  "careers",
  "help",
  "jobs",
  "support",
  "trial",
  "www",
]);

function pathParts(url: URL): string[] | null {
  try {
    return url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function normalizeTenant(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 120 ||
    RESERVED_TENANTS.has(normalized) ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function providerForHost(host: string): AtsProvider | null {
  const exact = EXACT_HOST_PROVIDERS.get(host) ?? BASE_HOST_PROVIDERS.get(host);
  if (exact) return exact;
  for (const [suffix, provider] of SUFFIX_HOST_PROVIDERS) {
    if (host.endsWith(suffix)) return provider;
  }
  return null;
}

function unmanagedProviderHint(host: string): string | null {
  if (
    host === "zohorecruit.com" ||
    host.endsWith(".zohorecruit.com") ||
    host === "zohorecruit.eu" ||
    host.endsWith(".zohorecruit.eu")
  ) {
    return "zoho_recruit";
  }
  if (host.endsWith(".oraclecloud.com") && (host.includes(".fa.") || host.startsWith("fa-"))) {
    return "oracle_fusion_hcm";
  }
  if (host === "gohiring.com" || host.endsWith(".gohiring.com")) return "gohiring";
  if (host === "occupop.com" || host.endsWith(".occupop.com")) return "occupop";
  if (host === "careers-page.com" || host.endsWith(".careers-page.com")) return "careers_page";
  if (host === "taleo.net" || host.endsWith(".taleo.net")) return "oracle_taleo";
  return null;
}

export function detectAtsEvidence(input: string | null | undefined): AtsDetectionEvidence {
  if (!input) {
    return { status: "no_apply_url", host: null, provider: null, providerHint: null, match: null };
  }

  let host: string;
  try {
    host = new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return {
      status: "invalid_url",
      host: null,
      provider: null,
      providerHint: null,
      match: "invalid_url",
    };
  }

  const classification = classifyAtsUrl(input);
  if (classification.provider) {
    return {
      status: "catalogued",
      host,
      provider: classification.provider,
      providerHint: null,
      match: classification.match,
    };
  }
  return {
    status: unmanagedProviderHint(host) ? "unmanaged" : "unclassified",
    host,
    provider: null,
    providerHint: unmanagedProviderHint(host),
    match: classification.match,
  };
}

function tenantFromSubdomain(host: string, suffix: string): string | null {
  if (!host.endsWith(suffix)) return null;
  return normalizeTenant(host.slice(0, -suffix.length));
}

function tenantForProvider(provider: AtsProvider, url: URL, parts: string[]): string | null {
  switch (provider) {
    case "greenhouse":
      return ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname)
        ? normalizeTenant(parts[0])
        : null;
    case "lever":
      return ["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname)
        ? normalizeTenant(parts[0])
        : null;
    case "ashby":
      return url.hostname === "jobs.ashbyhq.com" ? normalizeTenant(parts[0]) : null;
    case "workable":
      return url.hostname === "apply.workable.com" && parts[1] === "j"
        ? normalizeTenant(parts[0])
        : null;
    case "smartrecruiters":
      return ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"].includes(url.hostname)
        ? normalizeTenant(parts[0])
        : null;
    case "personio":
      return (
        tenantFromSubdomain(url.hostname, ".jobs.personio.com") ??
        tenantFromSubdomain(url.hostname, ".jobs.personio.de")
      );
    case "recruitee":
      return tenantFromSubdomain(url.hostname, ".recruitee.com");
    case "teamtailor":
      return tenantFromSubdomain(url.hostname, ".teamtailor.com");
    case "flatchr": {
      const companyIndex = parts.indexOf("company");
      return companyIndex >= 0 ? normalizeTenant(parts[companyIndex + 1]) : null;
    }
    case "nicoka":
      return url.hostname === "trial.nicoka.com"
        ? normalizeTenant(parts[0])
        : tenantFromSubdomain(url.hostname, ".nicoka.com");
    default:
      return null;
  }
}

function postingForProvider(provider: AtsProvider, url: URL, parts: string[]): string | null {
  switch (provider) {
    case "greenhouse": {
      const jobsIndex = parts.indexOf("jobs");
      return jobsIndex >= 0 ? (parts[jobsIndex + 1] ?? null) : null;
    }
    case "lever":
    case "ashby":
      return parts[1] ?? null;
    case "workable": {
      const jobIndex = parts.indexOf("j");
      return jobIndex >= 0 ? (parts[jobIndex + 1] ?? null) : null;
    }
    case "smartrecruiters": {
      const slug = parts[1];
      return slug?.match(/^\d+/)?.[0] ?? slug ?? null;
    }
    case "personio": {
      const jobIndex = parts.indexOf("job");
      return jobIndex >= 0 ? (parts[jobIndex + 1] ?? null) : null;
    }
    case "teamtailor":
    case "flatchr": {
      const jobsIndex = parts.indexOf("jobs");
      return parts[jobsIndex + 1]?.match(/^\d+/)?.[0] ?? null;
    }
    case "nicoka":
      return url.searchParams.get("jobid");
    default:
      return null;
  }
}

export function classifyAtsUrl(input: string): AtsUrlClassification {
  const originalUrl = input;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      originalUrl,
      provider: null,
      tenantKey: null,
      boardKey: null,
      postingId: null,
      match: "invalid_url",
    };
  }

  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
  }
  const provider = providerForHost(url.hostname.toLowerCase());
  if (!provider) {
    return {
      originalUrl,
      provider: null,
      tenantKey: null,
      boardKey: null,
      postingId: null,
      match: "unknown",
    };
  }

  const parts = pathParts(url);
  if (!parts) {
    return {
      originalUrl,
      provider: null,
      tenantKey: null,
      boardKey: null,
      postingId: null,
      match: "invalid_url",
    };
  }
  const tenantKey = tenantForProvider(provider, url, parts);
  return {
    originalUrl,
    provider,
    tenantKey,
    boardKey: tenantKey,
    postingId: postingForProvider(provider, url, parts),
    match: tenantKey ? "tenant" : "provider_only",
  };
}
