import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  sourceTrialBudgetStopReasonSchema,
  sourceTrialManifestSchema,
  sourceTrialResultSchema,
  type CanonicalJob,
  type SourceTrialManifest,
  type SourceTrialResult,
} from "@hirly/contracts";
import {
  sanitizeSourceDocument,
  toCanonicalJob,
  type NormalizedProviderJob,
} from "@hirly/ingestion";
import { classifyAtsUrl } from "@hirly/ingestion/ats";
import { stableDataGouvExternalId } from "@hirly/ingestion/data-gouv";
import {
  AtsTrialTransportError,
  type AtsTrialFetch,
} from "./providers/ats-trial-transport";
import type { SourceTrialEvidenceRepository } from "./source-trial";

export const BPCE_DATASET_ID =
  "groupe-bpce-offres-emploi-publiques" as const;
export const BPCE_RESOURCE_ID =
  "dc0d68bd-993f-48c1-b645-dbc91c6745b1" as const;
export const BPCE_RESOURCE_URL =
  "https://bpce.opendatasoft.com/api/explore/v2.1/catalog/datasets/groupe-bpce-offres-emploi/exports/json" as const;
export const BPCE_DATASET_PAGE =
  "https://www.data.gouv.fr/datasets/groupe-bpce-offres-emploi-publiques" as const;

export const bpceEvidenceTrialReadiness = Object.freeze({
  source: "bpce-open-feed",
  state: "BLOCKED_EXTERNAL",
  trialTransportImplemented: true,
  trialTransportReady: false,
  productionReady: false,
  productionEligible: false,
  canonicalWriteReady: false,
  sourceEnablementReady: false,
  blockers: Object.freeze([
    "fresh_sanitized_capture_digest_not_sealed_in_trial_policy",
    "trial_policy_not_provisioned",
    "non_sample_paid_cohort_value_unproven",
    "complete_snapshot_removal_reconciliation_unproven",
    "production_policy_and_writer_gates_unproven",
  ]),
} as const);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const safeText = z.string().trim().min(1).max(512);
const optionalText = z
  .union([z.string(), z.number(), z.boolean()])
  .transform(String)
  .pipe(z.string().trim().max(100_000))
  .nullable()
  .optional();
const safeHttpsUrl = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    context.addIssue({
      code: "custom",
      message: "BPCE URLs must be credential-free HTTPS URLs",
    });
  }
});

/**
 * The upstream record intentionally excludes recruiter name/email fields.
 * Zod strips every unknown top-level field before any evidence serialization
 * or content hash is produced.
 */
export const bpceUpstreamRecordSchema = z
  .object({
    title: safeText,
    lastmodifieddate: optionalText,
    referencenumber: z.union([z.string(), z.number()]).transform(String),
    apply_url: safeHttpsUrl,
    url: safeHttpsUrl,
    company: safeText,
    city: optionalText,
    state: optionalText,
    country: optionalText,
    description: z
      .string()
      .max(100_000)
      .nullable()
      .optional()
      .transform((value) => value ?? ""),
    category: optionalText,
    jobcode: optionalText,
    jobtype: optionalText,
    jobindustry: optionalText,
    organization: optionalText,
    step_up_academy: optionalText,
    manager_bpce: optionalText,
    zipcode: optionalText,
    degree: optionalText,
    salary_min: z.union([z.string(), z.number()]).nullable().optional(),
    salary_max: z.union([z.string(), z.number()]).nullable().optional(),
    teletravail: optionalText,
  })
  .strip();

export type BpceUpstreamRecord = z.output<typeof bpceUpstreamRecordSchema>;

const bpceUpstreamSnapshotSchema = z.array(bpceUpstreamRecordSchema).max(10_000);

const manifestBaseSchema = z
  .object({
    schemaVersion: z.literal("hirly.bpce-evidence-trial-resource.v1"),
    sourceId: z.uuid(),
    policyEvidenceId: z.uuid(),
    datasetId: z.literal(BPCE_DATASET_ID),
    resourceId: z.literal(BPCE_RESOURCE_ID),
    resourceUrl: z.literal(BPCE_RESOURCE_URL),
    countryCodes: z.tuple([z.literal("FR")]),
    sanitizedContentSha256: sha256Schema,
    expectedRecords: z.number().int().positive().max(10_000),
    policyArtifactDigest: sha256Schema,
    attribution: z
      .object({
        licenceName: z.literal("Licence Ouverte 2.0"),
        attributionText: z.string().trim().min(1).max(2_000),
        sourceUrl: z.literal(BPCE_DATASET_PAGE),
      })
      .strict(),
    budgets: z
      .object({
        maxRequests: z.literal(1),
        maxPages: z.literal(1),
        maxBytes: z.number().int().positive().max(25_000_000),
        timeoutMs: z.number().int().positive().max(120_000),
      })
      .strict(),
  })
  .strict();

const manifestSchema = manifestBaseSchema
  .extend({ manifestDigest: sha256Schema })
  .strict()
  .superRefine((value, context) => {
    const { manifestDigest: _manifestDigest, ...unsigned } = value;
    if (sha256(stableJson(unsigned)) !== value.manifestDigest) {
      context.addIssue({
        code: "custom",
        message: "BPCE trial resource manifest digest mismatch",
        path: ["manifestDigest"],
      });
    }
  });

export type BpceTrialResourceManifestInput = z.input<
  typeof manifestBaseSchema
>;
export type BpceTrialResourceManifest = z.output<typeof manifestSchema>;

export interface SanitizedBpceRecord {
  reference: string;
  title: string;
  employer: string;
  location: string;
  countryCode: "FR";
  description: string;
  contractType: string | null;
  status: "published";
  sourceUrl: string;
  applyUrl: string;
  publishedAt: string | null;
  category: string | null;
  jobCode: string | null;
  industry: string | null;
  remotePolicy: string | null;
}

export interface SanitizedBpceSnapshot {
  schemaVersion: "hirly.bpce-sanitized-snapshot.v1";
  datasetId: typeof BPCE_DATASET_ID;
  resourceId: typeof BPCE_RESOURCE_ID;
  records: SanitizedBpceRecord[];
}

export interface BpceTrialCandidate {
  candidateKey: string;
  contentHash: string;
  atsProvider: string | null;
  atsPostingId: string | null;
  canonicalApplyUrl: string;
  candidate: CanonicalJob;
}

export interface BpceSourceTrialPreview {
  schemaVersion: "hirly.bpce-source-trial-preview.v1";
  runId: string;
  trialKey: string;
  provider: "data_gouv";
  sourceKey: string;
  fetchedAt: string;
  complete: true;
  requestCount: 1;
  pageCount: 1;
  upstreamByteCount: number;
  evidenceByteCount: number;
  sanitizedContentHash: string;
  fetched: number;
  normalized: number;
  rejected: number;
  deduplicated: number;
  actionable: number;
  resourceManifest: BpceTrialResourceManifest;
  evidencePage: unknown;
  candidates: BpceTrialCandidate[];
  safeguards: {
    canonicalWrites: false;
    applicationWrites: false;
    queueWrites: false;
    providerOwnershipChanges: false;
    sourceActivationChanges: false;
    recruiterPiiPersisted: false;
  };
  digest: string;
}

export interface BoundBpceTrialTransport {
  readonly trialOnly: true;
  readonly manualInvocationOnly: true;
  readonly liveTransportReady: false;
  readonly productionEligible: false;
  readonly canonicalWriteReady: false;
  readonly credentialsAccepted: false;
  readonly resourceManifest: BpceTrialResourceManifest;
  fetch(signal: AbortSignal): Promise<{
    upstreamByteCount: number;
    snapshot: SanitizedBpceSnapshot;
  }>;
}

export function sanitizeBpceUpstreamSnapshot(
  input: unknown,
): SanitizedBpceSnapshot {
  const rows = bpceUpstreamSnapshotSchema.parse(input);
  return {
    schemaVersion: "hirly.bpce-sanitized-snapshot.v1",
    datasetId: BPCE_DATASET_ID,
    resourceId: BPCE_RESOURCE_ID,
    records: rows.map(mapBpceRecord),
  };
}

export function sanitizedBpceSnapshotDigest(input: unknown): string {
  return sha256(stableJson(sanitizeBpceUpstreamSnapshot(input)));
}

export function sealBpceTrialResourceManifest(
  input: BpceTrialResourceManifestInput,
): BpceTrialResourceManifest {
  const parsed = manifestBaseSchema.parse(input);
  return deepFreeze(
    manifestSchema.parse({
      ...parsed,
      manifestDigest: sha256(stableJson(parsed)),
    }),
  );
}

export function parseBpceTrialResourceManifest(
  input: unknown,
): BpceTrialResourceManifest {
  return deepFreeze(manifestSchema.parse(input));
}

export function createBpceTrialTransport(input: {
  resourceManifest: BpceTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  fetch?: AtsTrialFetch;
}): BoundBpceTrialTransport {
  const resourceManifest = parseBpceTrialResourceManifest(
    input.resourceManifest,
  );
  if (!input.approvedManifestDigests.includes(resourceManifest.manifestDigest)) {
    throw new AtsTrialTransportError(
      "permanent",
      "BPCE trial resource manifest is not allowlisted",
    );
  }
  const fetch = input.fetch ?? globalThis.fetch;
  return Object.freeze({
    trialOnly: true as const,
    manualInvocationOnly: true as const,
    liveTransportReady: false as const,
    productionEligible: false as const,
    canonicalWriteReady: false as const,
    credentialsAccepted: false as const,
    resourceManifest,
    async fetch(signal: AbortSignal) {
      const result = await fetchBpceJson({
        fetch,
        signal,
        maxBytes: resourceManifest.budgets.maxBytes,
        timeoutMs: resourceManifest.budgets.timeoutMs,
      });
      const snapshot = sanitizeBpceUpstreamSnapshot(result.payload);
      if (snapshot.records.length !== resourceManifest.expectedRecords) {
        throw new AtsTrialTransportError(
          "malformed",
          "BPCE trial record count does not match its sealed manifest",
        );
      }
      if (
        sha256(stableJson(snapshot)) !==
        resourceManifest.sanitizedContentSha256
      ) {
        throw new AtsTrialTransportError(
          "malformed",
          "BPCE sanitized response digest does not match its sealed manifest",
        );
      }
      return { upstreamByteCount: result.byteCount, snapshot };
    },
  });
}

export async function previewBpceSourceTrial(input: {
  manifest: SourceTrialManifest;
  resourceManifest: BpceTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  fetch?: AtsTrialFetch;
  signal?: AbortSignal;
  now?: () => Date;
  runId?: string;
}): Promise<BpceSourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  const now = input.now?.() ?? new Date();
  assertTrialBinding(manifest, input.resourceManifest, now);
  const transport = createBpceTrialTransport(input);
  const fetched = await transport.fetch(
    input.signal ?? new AbortController().signal,
  );
  if (fetched.snapshot.records.length > manifest.budget.maxCandidates) {
    throw new Error("trial_budget_exceeded:maxCandidates");
  }

  const candidates: BpceTrialCandidate[] = [];
  const identities = new Set<string>();
  let rejected = 0;
  let deduplicated = 0;
  for (const record of fetched.snapshot.records) {
    try {
      const normalized = normalizedJob(record);
      const canonical = toCanonicalJob(normalized, now);
      const candidateKey = `${canonical.provider}:${canonical.externalId}`;
      if (identities.has(candidateKey)) {
        deduplicated += 1;
        continue;
      }
      identities.add(candidateKey);
      const ats = classifyAtsUrl(record.applyUrl);
      candidates.push({
        candidateKey,
        contentHash: sha256(stableJson(canonical)),
        atsProvider: ats.provider,
        atsPostingId: ats.postingId,
        canonicalApplyUrl: record.applyUrl,
        candidate: canonical,
      });
    } catch {
      rejected += 1;
    }
  }
  const evidencePage = sanitizeSourceDocument({
    schemaVersion: "hirly.bpce-evidence-page.v1",
    resourceManifest: transport.resourceManifest,
    snapshot: fetched.snapshot,
    containsPersonalData: false,
    recruiterPiiPersisted: false,
  });
  const serializedEvidence = stableJson(evidencePage);
  const evidenceByteCount = Buffer.byteLength(serializedEvidence, "utf8");
  if (evidenceByteCount > manifest.budget.maxBytes) {
    throw new Error("trial_budget_exceeded:maxBytes");
  }
  const withoutDigest = {
    schemaVersion: "hirly.bpce-source-trial-preview.v1" as const,
    runId: input.runId ?? randomUUID(),
    trialKey: manifest.trialKey,
    provider: "data_gouv" as const,
    sourceKey: `${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}`,
    fetchedAt: now.toISOString(),
    complete: true as const,
    requestCount: 1 as const,
    pageCount: 1 as const,
    upstreamByteCount: fetched.upstreamByteCount,
    evidenceByteCount,
    sanitizedContentHash: sha256(stableJson(fetched.snapshot)),
    fetched: fetched.snapshot.records.length,
    normalized: candidates.length,
    rejected,
    deduplicated,
    actionable: candidates.filter(
      (candidate) => candidate.candidate.manualFulfillmentReady,
    ).length,
    resourceManifest: transport.resourceManifest,
    evidencePage,
    candidates,
    safeguards: {
      canonicalWrites: false as const,
      applicationWrites: false as const,
      queueWrites: false as const,
      providerOwnershipChanges: false as const,
      sourceActivationChanges: false as const,
      recruiterPiiPersisted: false as const,
    },
  };
  return {
    ...withoutDigest,
    digest: sha256(stableJson(withoutDigest)),
  };
}

export async function persistBpceSourceTrial(input: {
  manifest: SourceTrialManifest;
  resourceManifest: BpceTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  repository: SourceTrialEvidenceRepository;
  fetch?: AtsTrialFetch;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<BpceSourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  const admittedAt = input.now?.() ?? new Date();
  assertTrialBinding(manifest, input.resourceManifest, admittedAt);
  createBpceTrialTransport(input);
  const runId = await input.repository.beginSourceTrial(manifest);
  let pagesFetched = 0;
  let candidatesObserved = 0;
  let bytesStored = 0;
  try {
    const preview = await previewBpceSourceTrial({
      ...input,
      manifest,
      now: () => admittedAt,
      runId,
    });
    const serializedPayload = stableJson(preview.evidencePage);
    const pageId = await input.repository.recordSourceTrialPage({
      runId,
      pageNumber: 1,
      fetchedAt: new Date(preview.fetchedAt),
      serializedPayload,
      contentHash: sha256(serializedPayload),
      byteCount: preview.evidenceByteCount,
    });
    pagesFetched = 1;
    bytesStored = preview.evidenceByteCount;
    for (const candidate of preview.candidates) {
      await input.repository.recordSourceTrialCandidate({
        runId,
        pageId,
        candidateKey: candidate.candidateKey,
        serializedCandidate: stableJson(candidate),
        contentHash: candidate.contentHash,
      });
      candidatesObserved += 1;
    }
    await recordResult(input.repository, {
      runId,
      trialKey: manifest.trialKey,
      status: "completed",
      startedAt: manifest.requestedAt,
      finishedAt: preview.fetchedAt,
      pagesFetched,
      candidatesObserved,
      bytesStored,
      stopReason: null,
    });
    return preview;
  } catch (error) {
    const finishedAt = input.now?.() ?? new Date();
    const failure = classifyFailure(error, manifest, finishedAt);
    await recordResult(input.repository, {
      runId,
      trialKey: manifest.trialKey,
      status: failure.status,
      startedAt: manifest.requestedAt,
      finishedAt: finishedAt.toISOString(),
      pagesFetched,
      candidatesObserved,
      bytesStored,
      stopReason: failure.stopReason,
    });
    throw error;
  }
}

function mapBpceRecord(raw: BpceUpstreamRecord): SanitizedBpceRecord {
  const location = [raw.city, raw.state, raw.country]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  return {
    reference: raw.referencenumber.trim(),
    title: raw.title,
    employer: raw.organization ?? raw.company,
    location: location || "France",
    countryCode: "FR",
    description: raw.description,
    contractType: raw.jobtype ?? null,
    status: "published",
    sourceUrl: raw.url,
    applyUrl: raw.apply_url,
    publishedAt: parseBpceTimestamp(raw.lastmodifieddate),
    category: raw.category ?? null,
    jobCode: raw.jobcode ?? null,
    industry: raw.jobindustry ?? null,
    remotePolicy: raw.teletravail ?? null,
  };
}

function normalizedJob(record: SanitizedBpceRecord): NormalizedProviderJob {
  return {
    envelope: {
      provider: "data_gouv",
      externalId: stableDataGouvExternalId(
        BPCE_DATASET_ID,
        BPCE_RESOURCE_ID,
        record.reference,
      ),
      payload: {
        datasetId: BPCE_DATASET_ID,
        resourceId: BPCE_RESOURCE_ID,
        ...record,
      },
    },
    title: record.title,
    company: record.employer,
    location: record.location,
    countryCode: record.countryCode,
    description: record.description,
    contractType: record.contractType,
    status: record.status,
    applyUrls: [record.applyUrl, record.sourceUrl],
  };
}

function parseBpceTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i,
  );
  if (!match) return null;
  const [, day, month, year, rawHour, minute, second, period] = match;
  let hour = Number(rawHour);
  if (period?.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (period?.toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour,
      Number(minute),
      Number(second),
    ),
  ).toISOString();
}

async function fetchBpceJson(input: {
  fetch: AtsTrialFetch;
  signal: AbortSignal;
  maxBytes: number;
  timeoutMs: number;
}): Promise<{ payload: unknown; byteCount: number }> {
  if (input.signal.aborted) {
    throw new AtsTrialTransportError("cancelled", "BPCE trial request cancelled");
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("BPCE trial time budget exceeded")),
    input.timeoutMs,
  );
  try {
    let response: Response;
    try {
      response = await awaitWithAbort(
        input.fetch(BPCE_RESOURCE_URL, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        }),
        controller.signal,
      );
    } catch (error) {
      if (input.signal.aborted) {
        throw new AtsTrialTransportError(
          "cancelled",
          "BPCE trial request cancelled",
          null,
          { cause: error },
        );
      }
      throw new AtsTrialTransportError(
        controller.signal.aborted ? "budget_exceeded" : "retryable",
        controller.signal.aborted
          ? "BPCE trial request exceeded its time budget"
          : "BPCE trial network request failed",
        null,
        { cause: error },
      );
    }
    if (!response.ok) throw classifyHttpStatus(response.status);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/.test(contentType)
    ) {
      throw new AtsTrialTransportError(
        "malformed",
        "BPCE trial response must use a JSON content type",
        response.status,
      );
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > input.maxBytes)
    ) {
      throw new AtsTrialTransportError(
        "budget_exceeded",
        "BPCE trial response exceeds its byte budget",
        response.status,
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(
        response,
        input.maxBytes,
        controller.signal,
      );
    } catch (error) {
      if (error instanceof AtsTrialTransportError) throw error;
      if (input.signal.aborted) {
        throw new AtsTrialTransportError(
          "cancelled",
          "BPCE trial response read was cancelled",
          response.status,
          { cause: error },
        );
      }
      if (controller.signal.aborted) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "BPCE trial response exceeded its time budget",
          response.status,
          { cause: error },
        );
      }
      throw new AtsTrialTransportError(
        "retryable",
        "BPCE trial response body could not be read",
        response.status,
        { cause: error },
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      throw new AtsTrialTransportError(
        "malformed",
        "BPCE trial response is not valid UTF-8 JSON",
        response.status,
        { cause: error },
      );
    }
    return { payload, byteCount: bytes.byteLength };
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", onAbort);
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "BPCE trial response exceeded its time budget",
          response.status,
        );
      }
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "BPCE trial response exceeds its byte budget",
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function classifyHttpStatus(status: number): AtsTrialTransportError {
  if (status === 404 || status === 410) {
    return new AtsTrialTransportError("not_found", "BPCE resource not found", status);
  }
  if (status === 429) {
    return new AtsTrialTransportError("rate_limited", "BPCE rate limited", status);
  }
  if (status >= 500) {
    return new AtsTrialTransportError("retryable", "BPCE provider failed", status);
  }
  return new AtsTrialTransportError(
    "permanent",
    "BPCE provider rejected the request",
    status,
  );
}

function assertTrialBinding(
  manifest: SourceTrialManifest,
  resourceManifest: BpceTrialResourceManifest,
  now: Date,
): void {
  const resource = parseBpceTrialResourceManifest(resourceManifest);
  if (
    manifest.provider !== "data_gouv" ||
    manifest.sourceId !== resource.sourceId ||
    manifest.policyEvidenceId !== resource.policyEvidenceId ||
    manifest.tenantKey !== `${BPCE_DATASET_ID}:${BPCE_RESOURCE_ID}` ||
    stableJson(manifest.countryCodes) !== stableJson(resource.countryCodes)
  ) {
    throw new Error("trial_resource_manifest_mismatch");
  }
  if (resource.budgets.maxBytes > manifest.budget.maxBytes) {
    throw new Error("trial_resource_budget_exceeds_policy");
  }
  const requestedAt = new Date(manifest.requestedAt);
  const expiresAt = new Date(manifest.expiresAt);
  if (
    requestedAt.getTime() > now.getTime() ||
    expiresAt.getTime() <= now.getTime()
  ) {
    throw new Error("trial_policy_window_invalid");
  }
}

async function recordResult(
  repository: SourceTrialEvidenceRepository,
  result: Omit<SourceTrialResult, "schemaVersion">,
): Promise<void> {
  await repository.recordSourceTrialScorecard({
    runId: result.runId,
    scorecardKey: "trial-result",
    result: sourceTrialResultSchema.parse({
      schemaVersion: "hirly.source-trial-result.v1",
      ...result,
    }),
  });
}

function classifyFailure(
  error: unknown,
  manifest: SourceTrialManifest,
  finishedAt: Date,
): {
  status: SourceTrialResult["status"];
  stopReason: SourceTrialResult["stopReason"];
} {
  if (finishedAt.getTime() >= new Date(manifest.expiresAt).getTime()) {
    return { status: "policy_expired", stopReason: "policy_expired" };
  }
  if (error instanceof AtsTrialTransportError) {
    return {
      status:
        error.classification === "budget_exceeded"
          ? "budget_exhausted"
          : "failed",
      stopReason: error.classification,
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("trial_budget_exceeded:")) {
    return {
      status: "budget_exhausted",
      stopReason: sourceTrialBudgetStopReasonSchema.parse(
        message.slice("trial_".length),
      ),
    };
  }
  if (message === "trial_policy_window_invalid") {
    return { status: "policy_expired", stopReason: "policy_expired" };
  }
  return { status: "failed", stopReason: "unclassified_failure" };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
