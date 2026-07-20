import { createHash, randomUUID } from "node:crypto";
import {
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
import {
  createGreenhouseTrialTransport,
  greenhouseProvider,
  type GreenhouseRawJob,
} from "./providers/greenhouse";
import {
  createLeverTrialTransport,
  leverProvider,
  type LeverRawJob,
  type LeverTrialRegion,
} from "./providers/lever";
import type { AtsTrialFetch } from "./providers/ats-trial-transport";

export interface SourceTrialCandidate {
  candidateKey: string;
  contentHash: string;
  candidate: CanonicalJob;
}

export interface SourceTrialPreview {
  schemaVersion: "hirly.source-trial-preview.v1";
  runId: string;
  trialKey: string;
  provider: "greenhouse" | "lever";
  tenantKey: string;
  fetchedAt: string;
  complete: true;
  requestCount: 1;
  pageCount: 1;
  byteCount: number;
  fetched: number;
  normalized: number;
  rejected: number;
  deduplicated: number;
  pageContentHash: string;
  rawPage: unknown;
  candidates: SourceTrialCandidate[];
  safeguards: {
    canonicalWrites: false;
    applicationWrites: false;
    queueWrites: false;
    providerOwnershipChanges: false;
    sourceActivationChanges: false;
  };
  digest: string;
}

export interface SourceTrialEvidenceRepository {
  beginSourceTrial(manifest: SourceTrialManifest): Promise<string>;
  recordSourceTrialPage(input: {
    runId: string;
    pageNumber: number;
    fetchedAt: Date;
    contentHash: string;
    byteCount: number;
    payload: unknown;
  }): Promise<string>;
  recordSourceTrialCandidate(input: {
    runId: string;
    pageId: string;
    candidateKey: string;
    contentHash: string;
    candidate: CanonicalJob;
  }): Promise<void>;
  recordSourceTrialScorecard(input: {
    runId: string;
    scorecardKey: string;
    result: SourceTrialResult;
  }): Promise<void>;
}

export async function previewAtsSourceTrial(input: {
  manifest: SourceTrialManifest;
  fetch?: AtsTrialFetch;
  leverRegion?: LeverTrialRegion;
  signal?: AbortSignal;
  now?: () => Date;
  runId?: string;
}): Promise<SourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  assertTrialIsCurrent(manifest, input.now?.() ?? new Date());
  if (!["greenhouse", "lever"].includes(manifest.provider)) {
    throw new Error(`trial_provider_not_ready:${manifest.provider}`);
  }
  const signal = input.signal ?? new AbortController().signal;
  const fetchedAt = input.now?.() ?? new Date();
  const rows = await fetchRows(manifest, input.fetch, input.leverRegion, signal);
  const sanitizedRows = sanitizeSourceDocument(rows);
  const serializedPage = stableJson(sanitizedRows);
  const byteCount = Buffer.byteLength(serializedPage, "utf8");
  if (byteCount > manifest.budget.maxBytes) {
    throw new Error("trial_budget_exceeded:maxBytes");
  }
  if (rows.length > manifest.budget.maxCandidates) {
    throw new Error("trial_budget_exceeded:maxCandidates");
  }

  const candidates: SourceTrialCandidate[] = [];
  const identities = new Set<string>();
  let rejected = 0;
  let deduplicated = 0;
  for (const raw of rows) {
    try {
      const normalized = normalizeTrialRow(manifest, raw);
      const canonical = toCanonicalJob(normalized, fetchedAt);
      const identity = `${canonical.provider}:${canonical.externalId}`;
      if (identities.has(identity)) {
        deduplicated += 1;
        continue;
      }
      identities.add(identity);
      candidates.push({
        candidateKey: identity,
        contentHash: sha256(stableJson(canonical)),
        candidate: canonical,
      });
    } catch {
      rejected += 1;
    }
  }

  const withoutDigest = {
    schemaVersion: "hirly.source-trial-preview.v1" as const,
    runId: input.runId ?? randomUUID(),
    trialKey: manifest.trialKey,
    provider: manifest.provider as "greenhouse" | "lever",
    tenantKey: manifest.tenantKey,
    fetchedAt: fetchedAt.toISOString(),
    complete: true as const,
    requestCount: 1 as const,
    pageCount: 1 as const,
    byteCount,
    fetched: rows.length,
    normalized: candidates.length,
    rejected,
    deduplicated,
    pageContentHash: sha256(serializedPage),
    rawPage: sanitizedRows,
    candidates,
    safeguards: {
      canonicalWrites: false as const,
      applicationWrites: false as const,
      queueWrites: false as const,
      providerOwnershipChanges: false as const,
      sourceActivationChanges: false as const,
    },
  };
  return {
    ...withoutDigest,
    digest: sha256(stableJson(withoutDigest)),
  };
}

export async function persistAtsSourceTrial(input: {
  manifest: SourceTrialManifest;
  repository: SourceTrialEvidenceRepository;
  fetch?: AtsTrialFetch;
  leverRegion?: LeverTrialRegion;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<SourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  const runId = await input.repository.beginSourceTrial(manifest);
  const preview = await previewAtsSourceTrial({ ...input, manifest, runId });
  const pageId = await input.repository.recordSourceTrialPage({
    runId,
    pageNumber: 1,
    fetchedAt: new Date(preview.fetchedAt),
    contentHash: preview.pageContentHash,
    byteCount: preview.byteCount,
    payload: preview.rawPage,
  });
  for (const candidate of preview.candidates) {
    await input.repository.recordSourceTrialCandidate({
      runId,
      pageId,
      candidateKey: candidate.candidateKey,
      contentHash: candidate.contentHash,
      candidate: candidate.candidate,
    });
  }
  await input.repository.recordSourceTrialScorecard({
    runId,
    scorecardKey: "trial-result",
    result: sourceTrialResultSchema.parse({
      schemaVersion: "hirly.source-trial-result.v1",
      runId,
      trialKey: manifest.trialKey,
      status: "completed",
      startedAt: manifest.requestedAt,
      finishedAt: preview.fetchedAt,
      pagesFetched: preview.pageCount,
      candidatesObserved: preview.normalized,
      bytesStored: preview.byteCount,
      stopReason: null,
    }),
  });
  return preview;
}

async function fetchRows(
  manifest: SourceTrialManifest,
  fetch: AtsTrialFetch | undefined,
  leverRegion: LeverTrialRegion | undefined,
  signal: AbortSignal,
): Promise<readonly (GreenhouseRawJob | LeverRawJob)[]> {
  const budgets = {
    maxBytes: Math.min(manifest.budget.maxBytes, 10_000_000),
  };
  if (manifest.provider === "greenhouse") {
    return createGreenhouseTrialTransport({
      approvedTenantId: manifest.tenantKey,
      fetch,
      budgets,
    }).fetch(signal);
  }
  return createLeverTrialTransport({
    approvedTenantId: manifest.tenantKey,
    fetch,
    budgets,
    region: leverRegion ?? "global",
  }).fetch(signal);
}

function normalizeTrialRow(
  manifest: SourceTrialManifest,
  raw: GreenhouseRawJob | LeverRawJob,
): NormalizedProviderJob {
  const normalized =
    manifest.provider === "greenhouse"
      ? greenhouseProvider.adapter.normalizeRaw(raw as GreenhouseRawJob)
      : leverProvider.adapter.normalizeRaw(raw as LeverRawJob);
  const expectedPrefix = `${manifest.tenantKey}:`;
  if (!normalized.envelope.externalId.startsWith(expectedPrefix)) {
    throw new Error("trial_tenant_identity_mismatch");
  }
  return {
    ...normalized,
    countryCode: normalized.countryCode === "ZZ"
      ? manifest.countryCodes[0]
      : normalized.countryCode,
  };
}

function assertTrialIsCurrent(
  manifest: SourceTrialManifest,
  now: Date,
): void {
  const requestedAt = new Date(manifest.requestedAt);
  const expiresAt = new Date(manifest.expiresAt);
  if (requestedAt > now || expiresAt <= now) {
    throw new Error("trial_policy_window_invalid");
  }
  if (manifest.budget.maxPages < 1) {
    throw new Error("trial_budget_exceeded:maxPages");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
