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

export const ATS_PROVIDER_HOST_PATTERNS: Readonly<
  Record<AtsProvider, readonly string[]>
> = {
  greenhouse: [
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "greenhouse.io",
  ],
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
]);

const SUFFIX_HOST_PROVIDERS: ReadonlyArray<
  readonly [suffix: string, provider: AtsProvider]
> = [
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

function pathParts(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
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

function tenantFromSubdomain(host: string, suffix: string): string | null {
  if (!host.endsWith(suffix)) return null;
  return normalizeTenant(host.slice(0, -suffix.length));
}

function tenantForProvider(
  provider: AtsProvider,
  url: URL,
  parts: string[],
): string | null {
  switch (provider) {
    case "greenhouse":
      return ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
        url.hostname,
      )
        ? normalizeTenant(parts[0])
        : null;
    case "lever":
      return ["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname)
        ? normalizeTenant(parts[0])
        : null;
    case "ashby":
      return url.hostname === "jobs.ashbyhq.com"
        ? normalizeTenant(parts[0])
        : null;
    case "workable":
      return url.hostname === "apply.workable.com" && parts[1] === "j"
        ? normalizeTenant(parts[0])
        : null;
    case "smartrecruiters":
      return ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"].includes(
        url.hostname,
      )
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

function postingForProvider(
  provider: AtsProvider,
  url: URL,
  parts: string[],
): string | null {
  switch (provider) {
    case "greenhouse": {
      const jobsIndex = parts.indexOf("jobs");
      return jobsIndex >= 0 ? parts[jobsIndex + 1] ?? null : null;
    }
    case "lever":
    case "ashby":
      return parts[1] ?? null;
    case "workable": {
      const jobIndex = parts.indexOf("j");
      return jobIndex >= 0 ? parts[jobIndex + 1] ?? null : null;
    }
    case "smartrecruiters": {
      const slug = parts[1];
      return slug?.match(/^\d+/)?.[0] ?? slug ?? null;
    }
    case "personio": {
      const jobIndex = parts.indexOf("job");
      return jobIndex >= 0 ? parts[jobIndex + 1] ?? null : null;
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
