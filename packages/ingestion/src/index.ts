import { createHash } from "node:crypto";
import {
  canonicalJobSchema,
  rawProviderJobEnvelopeSchema,
  type CanonicalJob,
  type Provider,
  type ProviderSearchRequest,
  type RateLimitConfig,
  type RawProviderJobEnvelope,
  type SourceAccessType,
  type SourceCheckpoint,
  type SourceFetchRequest,
  type SourceLifecycleState,
  type SourceRegistryEntry,
  type SourceRuntimePolicy,
  type ValidationResult,
} from "@hirly/contracts";
import { classifyAtsUrl, isStrictAutoApplicableProvider } from "./ats";

export interface ProviderPage<RawJob> {
  items: RawJob[];
  nextCursor: string | null;
}

export interface ProviderTransport<RawJob> {
  fetch(
    request: ProviderSearchRequest,
    signal: AbortSignal,
  ): Promise<ProviderPage<RawJob>>;
}

export interface NormalizedProviderJob {
  envelope: RawProviderJobEnvelope;
  title: string;
  company: string;
  location: string;
  countryCode: string;
  description: string;
  contractType: string | null;
  status: string | null;
  applyUrls: string[];
  city?: string | null;
  region?: string | null;
  remote?: boolean | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  postedAt?: string | null;
  importedAt?: string | null;
  lastSeenAt?: string | null;
}

export interface ProviderAdapter<RawJob> {
  readonly provider: Provider;
  normalizeRaw(raw: RawJob): NormalizedProviderJob;
}

export interface SourcePage<RawJob, Cursor, Scope> {
  scope: Scope;
  items: RawJob[];
  nextCursor: Cursor | null;
  sourceReportedTotal: number | null;
  complete: boolean;
  requestCount: number;
  costMinor: number | null;
}

export interface SourceTransport<RawJob> {
  readonly liveTransportReady: false;
  fetch(
    request: SourceFetchRequest,
    signal: AbortSignal,
  ): Promise<SourcePage<RawJob, SourceCheckpoint, Record<string, unknown>>>;
}

export interface SourceContext {
  source: SourceRegistryEntry;
  runId: string;
  fetchedAt: Date;
}

export interface NormalizedOccurrence {
  job: NormalizedProviderJob;
  externalId: string;
  canonicalSourceUrl: string | null;
  canonicalApplyUrl: string | null;
  atsPostingId: string | null;
}

export interface SourceLifecycleEvidence {
  state: SourceLifecycleState;
  observedAt: Date;
  expiresAt: Date | null;
  reason: string;
}

export interface AttributionMetadata {
  policyId: string;
  licenceName: string | null;
  attributionText: string | null;
  sourceUrl: string | null;
}

export interface SourceAdapter<RawJob, Cursor, Scope> {
  readonly provider: Provider;
  readonly enabled: false;
  readonly liveTransportReady: false;
  readonly access: SourceAccessType;
  sourceIdentity(source: SourceRegistryEntry): {
    sourceId: string;
    datasetOrFeedId: string;
  };
  tenantIdentity(source: SourceRegistryEntry): {
    tenantKey: string | null;
    boardKey: string | null;
  };
  discover(input: {
    source: SourceRegistryEntry;
    mode: "full" | "incremental";
    cursor: Cursor | null;
    signal: AbortSignal;
  }): AsyncIterable<SourcePage<RawJob, Cursor, Scope>>;
  normalize(raw: RawJob, context: SourceContext): NormalizedOccurrence;
  validateActive(raw: RawJob, now: Date): SourceLifecycleEvidence;
  classifyError(
    error: unknown,
  ):
    | "retryable"
    | "rate_limited"
    | "authorization"
    | "permanent"
    | "malformed";
  attribution(raw: RawJob): AttributionMetadata;
}

export class DisabledSourceTransport<RawJob>
  implements SourceTransport<RawJob>
{
  readonly liveTransportReady = false as const;

  async fetch(
    _request: SourceFetchRequest,
    _signal: AbortSignal,
  ): Promise<SourcePage<RawJob, SourceCheckpoint, Record<string, unknown>>> {
    throw new IngestionError(
      "authorization_blocked",
      "source transport is disabled until policy approval and provider writer ownership are granted",
    );
  }
}

export interface CanonicalJobRepository {
  upsertCanonicalBatch(jobs: CanonicalJob[]): Promise<number>;
}

export interface IngestionMetrics {
  fetched: number;
  accepted: number;
  rejected: number;
  deduplicated: number;
  upserted: number;
  pages: number;
  durationsMs: {
    fetch: number;
    normalization: number;
    validation: number;
    database: number;
    total: number;
  };
}

export interface IngestionResult {
  jobs: CanonicalJob[];
  metrics: IngestionMetrics;
}

export class IngestionError extends Error {
  constructor(
    readonly code:
      | "authorization_blocked"
      | "invalid_input"
      | "provider_permanent"
      | "integrity_error",
    message: string,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

export type SourceActivationBlockReason =
  | "provider_disabled"
  | "provider_not_authorized"
  | "writer_not_typescript"
  | "source_disabled"
  | "transport_disabled"
  | "mode_disabled"
  | "country_not_declared"
  | "provider_country_killed"
  | "source_country_killed"
  | "policy_not_approved"
  | "policy_environment_blocked"
  | "policy_access_blocked"
  | "policy_expired";

export function sourceActivationBlockReason(
  input: SourceRuntimePolicy,
  countryCode: string,
  mode: "incremental" | "backfill",
  now: Date,
): SourceActivationBlockReason | null {
  const country = countryCode.toUpperCase();
  if (!input.providerEnabled) return "provider_disabled";
  if (input.providerAuthorizationStatus !== "authorized") {
    return "provider_not_authorized";
  }
  if (input.writerRuntime !== "typescript") return "writer_not_typescript";
  if (!input.source.enabled) return "source_disabled";
  if (!input.source.transportEnabled) return "transport_disabled";
  if (
    (mode === "incremental" && !input.source.incrementalEnabled) ||
    (mode === "backfill" && !input.source.backfillEnabled)
  ) {
    return "mode_disabled";
  }
  if (!input.source.countryCodes.includes(country)) {
    return "country_not_declared";
  }
  if (input.providerCountryKillSwitches[country] === true) {
    return "provider_country_killed";
  }
  if (input.sourceCountryKillSwitches[country] === true) {
    return "source_country_killed";
  }
  if (
    !input.policy.enabled ||
    input.policy.approvalStatus !== "approved" ||
    !input.policy.commercialUseAllowed ||
    !input.policy.redisplayAllowed ||
    !input.policy.fullTextRetentionAllowed
  ) {
    return "policy_not_approved";
  }
  if (!input.policy.enabledEnvironments.includes("production")) {
    return "policy_environment_blocked";
  }
  if (!input.policy.permittedAccessMethods.includes(input.source.accessType)) {
    return "policy_access_blocked";
  }
  if (
    !input.policy.expiresAt ||
    new Date(input.policy.expiresAt).getTime() <= now.getTime()
  ) {
    return "policy_expired";
  }
  return null;
}

type Clock = () => number;
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface ProviderRateGateOptions {
  /**
   * Overrides the fixed interval derived from requestsPerMinute. The interval
   * is sampled before every start after the first one.
   */
  startIntervalMs?: {
    min: number;
    max: number;
  };
  random?: () => number;
}

const defaultSleep: Sleep = (milliseconds, signal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export class ProviderRateGate {
  private active = 0;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private startQueue: Promise<void> = Promise.resolve();
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly config: RateLimitConfig,
    private readonly clock: Clock = Date.now,
    private readonly sleep: Sleep = defaultSleep,
    private readonly options: ProviderRateGateOptions = {},
  ) {}

  async run<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    await this.acquire(signal);
    try {
      return await this.startOperation(operation, signal);
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }

  private async startOperation<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let releaseStart!: () => void;
    const previousStart = this.startQueue;
    this.startQueue = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    await previousStart;
    let result: Promise<T>;
    try {
      const minimumInterval = this.nextStartIntervalMs();
      const delay = Math.max(
        0,
        this.lastStartedAt + minimumInterval - this.clock(),
      );
      if (delay > 0) await this.sleep(delay, signal);
      signal.throwIfAborted();
      this.lastStartedAt = this.clock();
      result = operation();
    } finally {
      releaseStart();
    }
    return await result;
  }

  private nextStartIntervalMs(): number {
    const configured = this.options.startIntervalMs;
    if (!configured) return 60_000 / this.config.requestsPerMinute;
    if (
      !Number.isFinite(configured.min) ||
      !Number.isFinite(configured.max) ||
      configured.min < 0 ||
      configured.max < configured.min
    ) {
      throw new Error("invalid provider start interval");
    }
    const random = Math.min(
      1,
      Math.max(0, (this.options.random ?? Math.random)()),
    );
    return configured.min + (configured.max - configured.min) * random;
  }

  private async acquire(signal: AbortSignal): Promise<void> {
    while (this.active >= this.config.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = this.waiters.indexOf(wake);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        this.waiters.push(wake);
      });
    }
    signal.throwIfAborted();
    this.active += 1;
  }
}

function sha1(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

const sensitiveKey =
  /(authorization|cookie|credential|database.?url|evidence.?body|password|secret|token)/i;
const piiKey = /(^|_)(email|phone|first.?name|last.?name|full.?name)($|_)/i;
const documentPiiKeys = [
  /^(?:cv|resume|curriculumvitae)(?:file|filename|document|content|bytes|body|data|url|path)?$/,
  /^(?:original|upload|uploaded|attachment|document|file)?filename$/,
  /^(?:fileupload|uploadedfile|uploadfile)(?:name|filename|content|bytes|body|data|url|path)?$/,
  /^(?:attachment|document|file)(?:content|bytes|body|data)$/,
];
const candidateContainerKey =
  /^(?:candidates?|applicants?|applications?)(?:(?:info|profiles?|payloads?|data|details|records?|submissions?)s?)?$/;
const candidateSensitiveScalarKey =
  /^(?:candidates?|applicants?|applications?)(?:firstnames?|lastnames?|fullnames?|names?|emails?|phones?|addresses?|birthdates?|dates?ofbirth|nationalids?|profileurls?|linkedinurls?|coverletters?|personalstatements?|messages?|notes?|freetexts?|texts?|answers?)$/;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d[\d\s.-]{7,}\d/g;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const credentialUrl = /\b(?:postgres(?:ql)?|https?):\/\/[^/\s:@]+:[^@\s]+@/gi;
const querySecret =
  /([?&](?:access_token|api_key|apikey|authorization|password|secret|token)=)[^&#\s]*/gi;

function normalizedSourceKey(key: string): string {
  return key
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isDocumentPiiKey(key: string): boolean {
  const normalized = normalizedSourceKey(key);
  return documentPiiKeys.some((pattern) => pattern.test(normalized));
}

function isCandidateContainerKey(key: string): boolean {
  const normalized = normalizedSourceKey(key);
  return (
    candidateContainerKey.test(normalized) ||
    candidateSensitiveScalarKey.test(normalized)
  );
}

export function sanitizeSourceDocument(
  value: unknown,
  key = "",
): unknown {
  if (
    sensitiveKey.test(key) ||
    piiKey.test(key) ||
    isDocumentPiiKey(key) ||
    isCandidateContainerKey(key)
  ) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    const preserveIsoTimestamp =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      );
    return value
      .replace(credentialUrl, (match) => {
        const schemeEnd = match.indexOf("://") + 3;
        return `${match.slice(0, schemeEnd)}[REDACTED]@`;
      })
      .replace(bearer, "Bearer [REDACTED]")
      .replace(querySecret, "$1[REDACTED]")
      .replace(email, "[REDACTED_EMAIL]")
      .replace(preserveIsoTimestamp ? /$^/ : phone, "[REDACTED_PHONE]");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSourceDocument(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        sanitizeSourceDocument(entry, entryKey),
      ]),
    );
  }
  return value;
}

export function stableJobId(provider: Provider, externalId: string): string {
  return `job_${sha1(`${provider}:${externalId}`).slice(0, 16)}`;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCompany(value: string): string {
  const suffixes = new Set([
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "company",
    "sa",
    "sas",
    "sarl",
    "gmbh",
    "plc",
  ]);
  const normalized = normalizeText(value);
  const withoutSuffixes = normalized
    .split(" ")
    .filter((part) => !suffixes.has(part))
    .join(" ");
  return withoutSuffixes || normalized;
}

export function normalizeTitle(value: string): string {
  const replacements: Record<string, string> = {
    sr: "senior",
    jr: "junior",
    mgr: "manager",
  };
  return normalizeText(value)
    .split(" ")
    .map((part) => replacements[part] ?? part)
    .join(" ");
}

export function normalizeCountryCode(value: string): string {
  const normalized = normalizeText(value);
  const aliases: Record<string, string> = {
    france: "FR",
    fr: "FR",
    "united states": "US",
    usa: "US",
    us: "US",
    "united kingdom": "GB",
    uk: "GB",
    gb: "GB",
    "great britain": "GB",
    morocco: "MA",
    maroc: "MA",
    ma: "MA",
  };
  const countryCode = aliases[normalized] ?? value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new IngestionError(
      "invalid_input",
      `unsupported country code: ${value}`,
    );
  }
  return countryCode;
}

const franceTravailApplyDomain = "candidat.francetravail.fr";
const accountRequiredDomains = [
  "apec.fr",
  "hellowork.com",
  "welcometothejungle.com",
  "indeed.com",
];
const discoveryOnlyDomains: Record<string, string> = {
  "simplyhired.com": "simplyhired",
  "talent.com": "talent",
  "adzuna.com": "adzuna",
  "jooble.org": "jooble",
  "jooble.com": "jooble",
};

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function findDomainMatch(
  host: string,
  domains: Iterable<string>,
): string | null {
  for (const domain of domains) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
  }
  return null;
}

export function selectApplyUrl(urls: string[]): string | null {
  const valid = urls.filter((url) => hostname(url) !== null);
  return (
    valid.find((url) => {
      const host = hostname(url);
      return classifyAtsUrl(url).provider !== null;
    }) ??
    valid.find((url) => {
      const host = hostname(url);
      return Boolean(
        host &&
          !findDomainMatch(host, accountRequiredDomains) &&
          !findDomainMatch(host, Object.keys(discoveryOnlyDomains)),
      );
    }) ??
    valid[0] ??
    null
  );
}

export function validateApplyability(
  job: NormalizedProviderJob,
  now: Date,
): ValidationResult {
  const selectedApplyUrl = selectApplyUrl(job.applyUrls);
  const checkedAt = now.toISOString();
  const rawText = JSON.stringify(job.envelope.payload).toLowerCase();
  const captchaDetected =
    rawText.includes("captcha") ||
    rawText.includes("recaptcha") ||
    rawText.includes("hcaptcha") ||
    rawText.includes("bot protection");
  const expired = ["expired", "closed", "inactive", "archived"].includes(
    job.status?.toLowerCase() ?? "",
  );

  const common = {
    selectedApplyUrl,
    validationCheckedAt: checkedAt,
    atsProvider: "unknown",
    applyUrlProvider: "unknown",
    requiresLogin: false,
    requiresAccountCreation: false,
    captchaDetected: false,
    manualFulfillmentReady: false,
    autoApplySupported: false,
  };

  if (!selectedApplyUrl) {
    return {
      ...common,
      validationStatus: "invalid",
      validationReason: "No apply URL is available.",
      applyabilityTier: "E",
      applyabilityScore: 0.02,
      applyFulfillmentStatus: "blocked_missing_apply_url",
      rejectionReason: "missing_apply_url",
    };
  }
  if (expired) {
    return {
      ...common,
      validationStatus: "invalid",
      validationReason: "Job appears expired or closed.",
      applyabilityTier: "E",
      applyabilityScore: 0.05,
      applyFulfillmentStatus: "blocked_expired",
      rejectionReason: "expired_or_closed",
    };
  }
  if (captchaDetected) {
    return {
      ...common,
      validationStatus: "invalid",
      validationReason:
        "Job payload contains CAPTCHA or bot-protection signals.",
      applyabilityTier: "E",
      applyabilityScore: 0.03,
      applyFulfillmentStatus: "blocked_captcha",
      captchaDetected: true,
      rejectionReason: "captcha_or_bot_protection",
    };
  }

  const host = hostname(selectedApplyUrl);
  if (
    job.envelope.provider === "france_travail" &&
    host === franceTravailApplyDomain
  ) {
    return {
      ...common,
      validationStatus: "valid",
      validationReason:
        "France Travail listing — apply on France Travail with guided manual fulfillment.",
      applyabilityTier: "B",
      applyabilityScore: 0.7,
      applyFulfillmentStatus: "manual_ready",
      applyUrlProvider: "francetravail",
      atsProvider: "francetravail",
      manualFulfillmentReady: true,
      rejectionReason: null,
    };
  }
  const atsProvider = classifyAtsUrl(selectedApplyUrl).provider;
  if (atsProvider) {
    const automatic = isStrictAutoApplicableProvider(atsProvider);
    return {
      ...common,
      validationStatus: "valid",
      validationReason: `Direct public application URL detected via ${atsProvider}.`,
      applyabilityTier: automatic ? "A" : "B",
      applyabilityScore: automatic ? 0.92 : 0.78,
      applyFulfillmentStatus: "manual_ready",
      applyUrlProvider: atsProvider,
      atsProvider,
      manualFulfillmentReady: true,
      autoApplySupported: automatic,
      rejectionReason: null,
    };
  }

  const accountDomain = host
    ? findDomainMatch(host, accountRequiredDomains)
    : null;
  if (accountDomain) {
    return {
      ...common,
      validationStatus: "invalid",
      validationReason: `${accountDomain} usually requires a candidate account or login.`,
      applyabilityTier: "D",
      applyabilityScore: 0.2,
      applyFulfillmentStatus: "blocked_user_account_required",
      applyUrlProvider: accountDomain,
      requiresLogin: true,
      requiresAccountCreation: true,
      rejectionReason: "login_or_account_required",
    };
  }

  const discoveryDomain = host
    ? findDomainMatch(host, Object.keys(discoveryOnlyDomains))
    : null;
  if (discoveryDomain) {
    const discoveryProvider =
      discoveryOnlyDomains[discoveryDomain] ?? discoveryDomain;
    return {
      ...common,
      validationStatus: "invalid",
      validationReason: `${discoveryProvider} is a discovery or aggregator destination, not a direct apply form.`,
      applyabilityTier: "D",
      applyabilityScore: 0.25,
      applyFulfillmentStatus: "discovery_only",
      applyUrlProvider: discoveryProvider,
      rejectionReason: "discovery_only",
    };
  }

  return {
    ...common,
    validationStatus: "unknown",
    validationReason:
      "Company career URL is not clearly blocked, but needs later browser validation.",
    applyabilityTier: "C",
    applyabilityScore: 0.55,
    applyFulfillmentStatus: "needs_validation",
    applyUrlProvider: host ?? "unknown",
    manualFulfillmentReady: true,
    rejectionReason: null,
  };
}

export function buildFingerprint(job: NormalizedProviderJob): string {
  const locationParts = job.location
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);
  return sha1(
    [
      normalizeCompany(job.company),
      normalizeTitle(job.title),
      locationParts[0] ?? "",
      locationParts[1] ?? "",
      normalizeText(job.countryCode),
      normalizeText(job.contractType ?? ""),
      normalizeText(job.description).slice(0, 500),
    ].join("|"),
  );
}

export function toCanonicalJob(
  job: NormalizedProviderJob,
  now: Date,
): CanonicalJob {
  const envelope = rawProviderJobEnvelopeSchema.parse(job.envelope);
  const validation = validateApplyability(job, now);
  return canonicalJobSchema.parse({
    jobId: stableJobId(envelope.provider, envelope.externalId),
    provider: envelope.provider,
    externalId: envelope.externalId,
    title: job.title.trim(),
    normalizedTitle: normalizeTitle(job.title),
    company: job.company.trim(),
    normalizedCompany: normalizeCompany(job.company),
    location: job.location.trim(),
    city: job.city ?? null,
    region: job.region ?? null,
    countryCode: normalizeCountryCode(job.countryCode),
    remote: job.remote ?? null,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    currency: job.currency ?? null,
    postedAt: job.postedAt ?? null,
    importedAt: job.importedAt ?? null,
    lastSeenAt: job.lastSeenAt ?? null,
    ...validation,
    fingerprint: buildFingerprint(job),
    data: sanitizeSourceDocument(envelope.payload),
  });
}

export async function runIngestion<RawJob>(input: {
  provider: Provider;
  transport: ProviderTransport<RawJob>;
  adapter: ProviderAdapter<RawJob>;
  repository: CanonicalJobRepository;
  request: ProviderSearchRequest;
  rateLimit: RateLimitConfig;
  signal?: AbortSignal;
  now?: () => Date;
  clock?: Clock;
  sleep?: Sleep;
  rateGate?: ProviderRateGate;
  onMetrics?: (metrics: IngestionMetrics) => void;
}): Promise<IngestionResult> {
  if (
    input.provider !== input.adapter.provider ||
    input.provider !== input.request.provider
  ) {
    throw new IngestionError(
      "integrity_error",
      "provider pipeline identity mismatch",
    );
  }
  const startedAt = performance.now();
  const signal = input.signal ?? new AbortController().signal;
  const now = input.now ?? (() => new Date());
  const rateGate =
    input.rateGate ??
    new ProviderRateGate(input.rateLimit, input.clock, input.sleep);
  const metrics: IngestionMetrics = {
    fetched: 0,
    accepted: 0,
    rejected: 0,
    deduplicated: 0,
    upserted: 0,
    pages: 0,
    durationsMs: {
      fetch: 0,
      normalization: 0,
      validation: 0,
      database: 0,
      total: 0,
    },
  };
  const jobs: CanonicalJob[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor = input.request.cursor;
  if (cursor) cursors.add(cursor);
  let terminalPageReached = false;

  for (let pageNumber = 0; pageNumber < input.request.maxPages; pageNumber += 1) {
    signal.throwIfAborted();
    const request = { ...input.request, cursor };
    const fetchStartedAt = performance.now();
    const page = await rateGate.run(
      () => input.transport.fetch(request, signal),
      signal,
    );
    metrics.durationsMs.fetch += performance.now() - fetchStartedAt;
    metrics.pages += 1;
    metrics.fetched += page.items.length;

    for (const raw of page.items) {
      const normalizationStartedAt = performance.now();
      try {
        const normalized = input.adapter.normalizeRaw(raw);
        metrics.durationsMs.normalization +=
          performance.now() - normalizationStartedAt;
        if (normalized.envelope.provider !== input.provider) {
          throw new IngestionError(
            "integrity_error",
            "normalized provider identity mismatch",
          );
        }
        const validationStartedAt = performance.now();
        const canonicalJob = toCanonicalJob(normalized, now());
        metrics.durationsMs.validation +=
          performance.now() - validationStartedAt;
        const identity = `${normalized.envelope.provider}:${normalized.envelope.externalId}`;
        if (identities.has(identity)) {
          metrics.deduplicated += 1;
          continue;
        }
        identities.add(identity);
        jobs.push(canonicalJob);
        metrics.accepted += 1;
      } catch (error) {
        metrics.durationsMs.normalization +=
          performance.now() - normalizationStartedAt;
        metrics.rejected += 1;
        if (error instanceof IngestionError && error.code === "integrity_error") {
          throw error;
        }
      }
    }

    if (!page.nextCursor) {
      terminalPageReached = true;
      break;
    }
    if (cursors.has(page.nextCursor) || page.nextCursor === cursor) {
      throw new IngestionError(
        "provider_permanent",
        `provider cursor repeated: ${page.nextCursor}`,
      );
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  if (!terminalPageReached) {
    throw new IngestionError(
      "provider_permanent",
      "provider pagination reached maxPages before exhaustion",
    );
  }
  if (jobs.length > 500) {
    throw new IngestionError(
      "invalid_input",
      "canonical batch exceeds the 500 job writer limit",
    );
  }
  if (jobs.length > 0) {
    const databaseStartedAt = performance.now();
    metrics.upserted = await input.repository.upsertCanonicalBatch(jobs);
    metrics.durationsMs.database += performance.now() - databaseStartedAt;
    if (metrics.upserted !== jobs.length) {
      throw new IngestionError(
        "integrity_error",
        "canonical repository did not accept the full batch",
      );
    }
  }
  metrics.durationsMs.total = performance.now() - startedAt;
  input.onMetrics?.(metrics);
  return { jobs, metrics };
}
