import { isIP } from "node:net";
import {
  careerSourceCandidateRegistrationSchema,
  type CareerSourceCandidate,
  type CareerSourceCandidateRegistration,
} from "@hirly/contracts";
import { classifyAtsUrl, type AtsProvider } from "./ats";

export const ATS_DISCOVERY_RESOURCE_LIMITS = {
  maxRedirects: 3,
  maxUrlLength: 2_048,
  maxDnsAnswers: 8,
  connectTimeoutMs: 3_000,
  readTimeoutMs: 10_000,
  totalTimeoutMs: 15_000,
  maxCompressedBytes: 1_048_576,
  maxDecompressedBytes: 4_194_304,
  maxStructuredDepth: 32,
  maxStructuredItems: 5_000,
} as const;

export type AtsDiscoveryRejectionCode =
  | "invalid_url"
  | "url_too_long"
  | "https_required"
  | "credentials_forbidden"
  | "port_forbidden"
  | "ip_literal_host_blocked"
  | "hostname_invalid"
  | "unsupported_ats_url"
  | "tenant_missing"
  | "redirect_limit_exceeded"
  | "dns_answers_required"
  | "dns_answer_limit_exceeded"
  | "dns_answer_invalid"
  | "dns_answer_not_public"
  | "registration_not_disabled";

export class AtsDiscoveryRejectedError extends Error {
  constructor(
    readonly code: AtsDiscoveryRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "AtsDiscoveryRejectedError";
  }
}

export interface AtsDiscoveryHopInput {
  url: string;
  resolvedAddresses: string[];
}

export interface ValidatedAtsDiscoveryHop {
  url: string;
  provider: AtsProvider;
  tenantKey: string;
  asciiHostname: string;
  pinnedAddress: string;
}

export interface ValidatedAtsDiscoveryChain {
  hops: ValidatedAtsDiscoveryHop[];
  final: ValidatedAtsDiscoveryHop;
}

export interface AtsTenantCandidateRegistrar {
  registerCareerSourceCandidate(
    candidate: CareerSourceCandidateRegistration,
  ): Promise<CareerSourceCandidate>;
}

export interface RegisterDiscoveredAtsTenantInput {
  redirectChain: AtsDiscoveryHopInput[];
  countryCodes: string[];
  companyId?: string | null;
  companyName?: string | null;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every(
    (octet, index) =>
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255 &&
      String(octet) === parts[index],
  )
    ? octets
    : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return a > 0 && a < 224;
}

function ipv6ToBigInt(address: string): bigint | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const ipv4Tail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return null;
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized = normalized.replace(
      ipv4Tail,
      `${high.toString(16)}:${low.toString(16)}`,
    );
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  );
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value === null || value === 0n || value === 1n) return false;
  if (value >> 32n === 0xffffn) {
    const ipv4 = Number(value & 0xffffffffn);
    return isPublicIpv4(
      [
        (ipv4 >>> 24) & 255,
        (ipv4 >>> 16) & 255,
        (ipv4 >>> 8) & 255,
        ipv4 & 255,
      ].join("."),
    );
  }
  // Current globally routable unicast space is 2000::/3. Special transition
  // and documentation prefixes inside it remain denied below.
  if (value >> 125n !== 1n) return false;
  if (value >> 96n === 0x20010db8n) return false;
  if (value >> 112n === 0x2002n) return false;
  if (value >> 96n === 0x20010000n) return false;
  if (value >> 32n === 0x64ff9b000000000000000000n) return false;
  return true;
}

export function isPublicDiscoveryAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return isPublicIpv4(normalized);
  if (version === 6) return isPublicIpv6(normalized);
  return false;
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (isIP(hostname) !== 0) {
    throw new AtsDiscoveryRejectedError(
      "ip_literal_host_blocked",
      "ATS discovery requires a provider-approved DNS hostname",
    );
  }
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.split(".").some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new AtsDiscoveryRejectedError(
      "hostname_invalid",
      "ATS discovery hostname is not a bounded ASCII/IDNA hostname",
    );
  }
  return hostname;
}

function validateAtsDiscoveryHop(
  input: AtsDiscoveryHopInput,
): ValidatedAtsDiscoveryHop {
  if (input.url.length > ATS_DISCOVERY_RESOURCE_LIMITS.maxUrlLength) {
    throw new AtsDiscoveryRejectedError(
      "url_too_long",
      "ATS discovery URL exceeds the bounded length",
    );
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new AtsDiscoveryRejectedError(
      "invalid_url",
      "ATS discovery URL is invalid",
    );
  }
  if (url.protocol !== "https:") {
    throw new AtsDiscoveryRejectedError(
      "https_required",
      "ATS discovery requires HTTPS",
    );
  }
  if (url.username || url.password) {
    throw new AtsDiscoveryRejectedError(
      "credentials_forbidden",
      "ATS discovery URLs cannot contain credentials",
    );
  }
  if (url.port && url.port !== "443") {
    throw new AtsDiscoveryRejectedError(
      "port_forbidden",
      "ATS discovery permits only HTTPS port 443",
    );
  }
  const asciiHostname = normalizedHostname(url);
  const classification = classifyAtsUrl(url.href);
  if (!classification.provider) {
    throw new AtsDiscoveryRejectedError(
      "unsupported_ats_url",
      "ATS discovery URL does not match an approved provider host pattern",
    );
  }
  if (!classification.tenantKey) {
    throw new AtsDiscoveryRejectedError(
      "tenant_missing",
      "ATS discovery URL does not contain a bounded provider tenant",
    );
  }
  if (input.resolvedAddresses.length === 0) {
    throw new AtsDiscoveryRejectedError(
      "dns_answers_required",
      "ATS discovery requires DNS results resolved immediately before use",
    );
  }
  if (
    input.resolvedAddresses.length >
    ATS_DISCOVERY_RESOURCE_LIMITS.maxDnsAnswers
  ) {
    throw new AtsDiscoveryRejectedError(
      "dns_answer_limit_exceeded",
      "ATS discovery DNS answer count exceeds the bound",
    );
  }
  const addresses = [...new Set(input.resolvedAddresses.map((value) => value.trim()))];
  for (const address of addresses) {
    if (isIP(address) === 0) {
      throw new AtsDiscoveryRejectedError(
        "dns_answer_invalid",
        "ATS discovery DNS results must be literal IP addresses",
      );
    }
    if (!isPublicDiscoveryAddress(address)) {
      throw new AtsDiscoveryRejectedError(
        "dns_answer_not_public",
        "ATS discovery DNS results must all be globally routable",
      );
    }
  }
  addresses.sort();
  return {
    url: url.href,
    provider: classification.provider,
    tenantKey: classification.tenantKey,
    asciiHostname,
    pinnedAddress: addresses[0] as string,
  };
}

export function validateAtsDiscoveryRedirectChain(
  inputs: AtsDiscoveryHopInput[],
): ValidatedAtsDiscoveryChain {
  if (inputs.length === 0) {
    throw new AtsDiscoveryRejectedError(
      "invalid_url",
      "ATS discovery redirect chain cannot be empty",
    );
  }
  if (inputs.length - 1 > ATS_DISCOVERY_RESOURCE_LIMITS.maxRedirects) {
    throw new AtsDiscoveryRejectedError(
      "redirect_limit_exceeded",
      "ATS discovery redirect count exceeds the bound",
    );
  }
  const hops = inputs.map(validateAtsDiscoveryHop);
  const final = hops[hops.length - 1] as ValidatedAtsDiscoveryHop;
  return { hops, final };
}

function candidateBaseUrl(hop: ValidatedAtsDiscoveryHop): string {
  const tenant = encodeURIComponent(hop.tenantKey);
  const url = new URL(hop.url);
  switch (hop.provider) {
    case "greenhouse":
      return `https://${url.hostname}/${tenant}`;
    case "lever":
    case "ashby":
    case "workable":
    case "smartrecruiters":
      return `https://${url.hostname}/${tenant}`;
    case "personio":
    case "recruitee":
    case "nicoka":
      return url.hostname === "trial.nicoka.com"
        ? `https://${url.hostname}/${tenant}`
        : `https://${url.hostname}`;
    case "teamtailor":
      return `https://${url.hostname}/jobs`;
    case "flatchr":
      return `https://${url.hostname}/fr/company/${tenant}`;
    default:
      throw new AtsDiscoveryRejectedError(
        "unsupported_ats_url",
        "ATS provider has no tenant registration base URL",
      );
  }
}

export async function registerDiscoveredAtsTenant(
  registrar: AtsTenantCandidateRegistrar,
  input: RegisterDiscoveredAtsTenantInput,
): Promise<CareerSourceCandidate> {
  const chain = validateAtsDiscoveryRedirectChain(input.redirectChain);
  const final = chain.final;
  const registration = careerSourceCandidateRegistrationSchema.parse({
    provider: final.provider,
    sourceKey: `${final.provider}:${final.tenantKey}`,
    tenantKey: final.tenantKey,
    companyId: input.companyId ?? null,
    companyName: input.companyName ?? null,
    countryCodes: [
      ...new Set(input.countryCodes.map((code) => code.trim().toUpperCase())),
    ].sort(),
    baseUrl: candidateBaseUrl(final),
    accessType: "tenant_feed",
    policyId: null,
    syncFrequencySeconds: null,
    checkpoint: {
      version: "ats-discovery.v1",
      observedHost: final.asciiHostname,
    },
  });
  const candidate =
    await registrar.registerCareerSourceCandidate(registration);
  if (
    candidate.enabled ||
    candidate.transportEnabled ||
    candidate.incrementalEnabled ||
    candidate.backfillEnabled
  ) {
    throw new AtsDiscoveryRejectedError(
      "registration_not_disabled",
      "discovered ATS candidates must remain disabled",
    );
  }
  return candidate;
}
