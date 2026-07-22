import { createHash, randomUUID } from "node:crypto";
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
import { AtsTrialTransportError, type AtsTrialFetch } from "./providers/ats-trial-transport";

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
    serializedPayload: string;
    contentHash: string;
    byteCount: number;
  }): Promise<string>;
  recordSourceTrialCandidate(input: {
    runId: string;
    pageId: string;
    candidateKey: string;
    serializedCandidate: string;
    contentHash: string;
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
  let pagesFetched = 0;
  let candidatesObserved = 0;
  let bytesStored = 0;
  try {
    const preview = await previewAtsSourceTrial({ ...input, manifest, runId });
    const serializedPayload = stableJson(preview.rawPage);
    const pageId = await input.repository.recordSourceTrialPage({
      runId,
      pageNumber: 1,
      fetchedAt: new Date(preview.fetchedAt),
      serializedPayload,
      contentHash: preview.pageContentHash,
      byteCount: preview.byteCount,
    });
    pagesFetched = 1;
    bytesStored = preview.byteCount;
    for (const candidate of preview.candidates) {
      await input.repository.recordSourceTrialCandidate({
        runId,
        pageId,
        candidateKey: candidate.candidateKey,
        serializedCandidate: stableJson(candidate.candidate),
        contentHash: candidate.contentHash,
      });
      candidatesObserved += 1;
    }
    await recordTrialResult(input.repository, {
      runId,
      trialKey: manifest.trialKey,
      status: "completed",
      startedAt: manifest.requestedAt,
      finishedAt: preview.fetchedAt,
      pagesFetched: preview.pageCount,
      candidatesObserved: preview.normalized,
      bytesStored: preview.byteCount,
      stopReason: null,
    });
    return preview;
  } catch (error) {
    const finishedAt = input.now?.() ?? new Date();
    const failure = classifyTrialFailure(error, manifest, finishedAt);
    try {
      await recordTrialResult(input.repository, {
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
    } catch (evidenceError) {
      throw new AggregateError([error, evidenceError], "trial_failure_evidence_write_failed");
    }
    throw error;
  }
}

async function recordTrialResult(
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

function classifyTrialFailure(
  error: unknown,
  manifest: SourceTrialManifest,
  finishedAt: Date,
): {
  status: SourceTrialResult["status"];
  stopReason: SourceTrialResult["stopReason"];
} {
  if (finishedAt >= new Date(manifest.expiresAt)) {
    return { status: "policy_expired", stopReason: "policy_expired" };
  }
  if (error instanceof AtsTrialTransportError) {
    return {
      status: error.classification === "budget_exceeded" ? "budget_exhausted" : "failed",
      stopReason: error.classification,
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("trial_budget_exceeded:")) {
    return {
      status: "budget_exhausted",
      stopReason: sourceTrialBudgetStopReasonSchema.parse(message.slice("trial_".length)),
    };
  }
  if (message === "trial_policy_window_invalid") {
    return { status: "failed", stopReason: "unclassified_failure" };
  }
  if (message === "trial_policy_not_started") {
    return { status: "failed", stopReason: "policy_not_started" };
  }
  if (message === "trial_policy_expired") {
    return { status: "policy_expired", stopReason: "policy_expired" };
  }
  return { status: "failed", stopReason: "unclassified_failure" };
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
    countryCode:
      normalized.countryCode === "ZZ" ? manifest.countryCodes[0] : normalized.countryCode,
  };
}

function assertTrialIsCurrent(manifest: SourceTrialManifest, now: Date): void {
  const requestedAt = new Date(manifest.requestedAt);
  const expiresAt = new Date(manifest.expiresAt);
  if (requestedAt > now) throw new Error("trial_policy_not_started");
  if (expiresAt <= now) throw new Error("trial_policy_expired");
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
