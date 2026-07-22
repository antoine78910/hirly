import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  sourceTrialBudgetStopReasonSchema,
  sourceTrialManifestSchema,
  sourceTrialResultSchema,
  type SourceTrialManifest,
  type SourceTrialResult,
} from "@hirly/contracts";
import { stableDataGouvExternalId } from "@hirly/ingestion/data-gouv";
import type { AtsTrialFetch, AtsTrialTransportBudgets } from "./providers/ats-trial-transport";
import type { SourceTrialEvidenceRepository } from "./source-trial";

export const QUALIFIED_CSP_DATASET_ID = "6322e99e12175f7eb26ff465" as const;
export const QUALIFIED_CSP_RESOURCE_ID = "867034a2-2fa1-41b4-bd39-c84691ea618f" as const;
export const QUALIFIED_CSP_RESOURCE_URL =
  "https://static.data.gouv.fr/resources/les-offres-diffusees-sur-choisir-le-service-public/20260720-060055/offres-datagouv-20260628.csv" as const;
export const QUALIFIED_CSP_CONTENT_SHA256 =
  "a4c34e24156138e89e83a9a98a296214a81f39b4bdf3f89aff83e62069fb1e5b" as const;
export const QUALIFIED_CSP_BYTE_LENGTH = 84_407_563 as const;
export const G016_SOURCE_POLICY_ARTIFACT_SHA256 =
  "e027e21f14809ea33ab3dd7eec79bfd7f33928c5646ea188adc2e1a2bada8aad" as const;

export const cspQualifiedEvidenceReadiness = Object.freeze({
  source: "choisir-le-service-public",
  state: "qualified_evidence_only",
  trialTransportReady: true,
  productionReady: false,
  canonicalWriteReady: false,
  blockers: Object.freeze([
    "no_canonical_apply_route",
    "freshness_expiry_and_duplicate_gates_unproven",
    "production_attribution_and_lifecycle_gates_unproven",
  ]),
  sourcePolicyArtifact:
    "artifacts/job-ingestion/source-policy/g016-official-access-2026-07-20.json",
} as const);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const safeResourceUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "static.data.gouv.fr" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    context.addIssue({
      code: "custom",
      message:
        "CSP evidence resource must use a query-free credential-free static.data.gouv.fr URL",
    });
  }
});

const expectedCountsSchema = z
  .object({
    parsedRows: z.number().int().positive(),
    uniqueReferences: z.number().int().positive(),
    activeAtSnapshotRows: z.number().int().nonnegative(),
    activeAtSnapshotUniqueReferences: z.number().int().nonnegative(),
    activeAtCaptureRows: z.number().int().nonnegative(),
    activeAtCaptureUniqueReferences: z.number().int().nonnegative(),
  })
  .strict();

const manifestBaseSchema = z
  .object({
    schemaVersion: z.literal("hirly.csp-evidence-trial-resource.v1"),
    sourceId: z.uuid(),
    policyEvidenceId: z.uuid(),
    datasetId: z.string().trim().min(1).max(512),
    resourceId: z.string().trim().min(1).max(512),
    resourceUrl: safeResourceUrlSchema,
    contentSha256: sha256Schema,
    byteLength: z.number().int().positive().max(100_000_000),
    sourcePolicyArtifactSha256: sha256Schema,
    snapshotDate: z.iso.date(),
    captureDate: z.iso.date(),
    expectedCounts: expectedCountsSchema,
    budgets: z
      .object({
        maxRequests: z.literal(1),
        maxPages: z.literal(1),
        maxBytes: z.number().int().positive().max(100_000_000),
        timeoutMs: z.number().int().positive().max(120_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.budgets.maxBytes < value.byteLength) {
      context.addIssue({
        code: "custom",
        message: "CSP transport byte budget is smaller than the sealed resource",
        path: ["budgets", "maxBytes"],
      });
    }
    if (
      value.expectedCounts.uniqueReferences > value.expectedCounts.parsedRows ||
      value.expectedCounts.activeAtSnapshotUniqueReferences >
        value.expectedCounts.activeAtSnapshotRows ||
      value.expectedCounts.activeAtCaptureUniqueReferences >
        value.expectedCounts.activeAtCaptureRows
    ) {
      context.addIssue({
        code: "custom",
        message: "CSP expected unique counts cannot exceed row counts",
        path: ["expectedCounts"],
      });
    }
  });

const manifestSchema = z
  .object({
    ...manifestBaseSchema.shape,
    manifestDigest: sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const { manifestDigest: _manifestDigest, ...unsigned } = value;
    const baseResult = manifestBaseSchema.safeParse(unsigned);
    if (!baseResult.success) {
      for (const issue of baseResult.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
      }
      return;
    }
    if (sha256(stableJson(unsigned)) !== value.manifestDigest) {
      context.addIssue({
        code: "custom",
        message: "CSP trial resource manifest digest mismatch",
        path: ["manifestDigest"],
      });
    }
  });

export type CspTrialResourceManifestInput = z.input<typeof manifestBaseSchema>;
export type CspTrialResourceManifest = z.output<typeof manifestSchema>;

export interface CspEvidenceCandidate {
  schemaVersion: "hirly.csp-evidence-candidate.v1";
  candidateKey: string;
  externalId: string;
  reference: string;
  title: string;
  employer: string;
  location: string;
  publicationStartsAt: string | null;
  publicationEndsAt: string | null;
  activeAtSnapshot: boolean;
  activeAtCapture: boolean;
  actionable: false;
  blocker: "no_canonical_apply_route";
  contentHash: string;
}

export interface CspSourceTrialPreview {
  schemaVersion: "hirly.csp-evidence-trial-preview.v1";
  runId: string;
  trialKey: string;
  provider: "data_gouv";
  sourceKey: string;
  fetchedAt: string;
  complete: true;
  requestCount: 1;
  pageCount: 1;
  resourceByteCount: number;
  evidenceByteCount: number;
  resourceContentHash: string;
  resourceManifest: CspTrialResourceManifest;
  parsedRows: number;
  normalized: number;
  rejected: number;
  deduplicated: number;
  activeAtSnapshotRows: number;
  activeAtSnapshotUniqueReferences: number;
  activeAtCaptureRows: number;
  activeAtCaptureUniqueReferences: number;
  actionable: 0;
  candidates: CspEvidenceCandidate[];
  evidencePage: unknown;
  safeguards: {
    canonicalWrites: false;
    applicationWrites: false;
    queueWrites: false;
    providerOwnershipChanges: false;
    sourceActivationChanges: false;
  };
  digest: string;
}

export class CspTrialTransportError extends Error {
  constructor(
    readonly classification:
      | "not_found"
      | "rate_limited"
      | "retryable"
      | "permanent"
      | "malformed"
      | "budget_exceeded"
      | "cancelled",
    message: string,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CspTrialTransportError";
  }
}

export function sealCspTrialResourceManifest(
  input: CspTrialResourceManifestInput,
): CspTrialResourceManifest {
  const parsed = manifestBaseSchema.parse(input);
  return deepFreeze(
    manifestSchema.parse({
      ...parsed,
      manifestDigest: sha256(stableJson(parsed)),
    }),
  );
}

export function parseCspTrialResourceManifest(input: unknown): CspTrialResourceManifest {
  return deepFreeze(manifestSchema.parse(input));
}

export function sealQualifiedCspTrialResourceManifest(input: {
  sourceId: string;
  policyEvidenceId: string;
  maxBytes?: number;
  timeoutMs?: number;
}): CspTrialResourceManifest {
  return sealCspTrialResourceManifest({
    schemaVersion: "hirly.csp-evidence-trial-resource.v1",
    sourceId: input.sourceId,
    policyEvidenceId: input.policyEvidenceId,
    datasetId: QUALIFIED_CSP_DATASET_ID,
    resourceId: QUALIFIED_CSP_RESOURCE_ID,
    resourceUrl: QUALIFIED_CSP_RESOURCE_URL,
    contentSha256: QUALIFIED_CSP_CONTENT_SHA256,
    byteLength: QUALIFIED_CSP_BYTE_LENGTH,
    sourcePolicyArtifactSha256: G016_SOURCE_POLICY_ARTIFACT_SHA256,
    snapshotDate: "2026-06-28",
    captureDate: "2026-07-20",
    expectedCounts: {
      parsedRows: 183_467,
      uniqueReferences: 181_643,
      activeAtSnapshotRows: 42_660,
      activeAtSnapshotUniqueReferences: 42_321,
      activeAtCaptureRows: 18_409,
      activeAtCaptureUniqueReferences: 18_242,
    },
    budgets: {
      maxRequests: 1,
      maxPages: 1,
      maxBytes: input.maxBytes ?? 90_000_000,
      timeoutMs: input.timeoutMs ?? 60_000,
    },
  });
}

export interface BoundCspTrialTransport {
  readonly trialOnly: true;
  readonly manualInvocationOnly: true;
  readonly liveTransportReady: false;
  readonly canonicalWriteReady: false;
  readonly credentialsAccepted: false;
  readonly resourceManifest: CspTrialResourceManifest;
  fetch(signal: AbortSignal): Promise<string>;
}

export function createCspTrialTransport(input: {
  resourceManifest: CspTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  fetch?: AtsTrialFetch;
}): BoundCspTrialTransport {
  const resourceManifest = validateApprovedManifest(
    input.resourceManifest,
    input.approvedManifestDigests,
  );
  const fetch = input.fetch ?? globalThis.fetch;
  return Object.freeze({
    trialOnly: true as const,
    manualInvocationOnly: true as const,
    liveTransportReady: false as const,
    canonicalWriteReady: false as const,
    credentialsAccepted: false as const,
    resourceManifest,
    async fetch(signal: AbortSignal): Promise<string> {
      const bytes = await fetchBoundedBytes({
        url: new URL(resourceManifest.resourceUrl),
        budgets: resourceManifest.budgets,
        fetch,
        signal,
      });
      if (bytes.byteLength !== resourceManifest.byteLength) {
        throw new CspTrialTransportError(
          "malformed",
          "CSP trial resource byte length does not match its sealed manifest",
        );
      }
      if (sha256Bytes(bytes) !== resourceManifest.contentSha256) {
        throw new CspTrialTransportError(
          "malformed",
          "CSP trial resource digest does not match its sealed manifest",
        );
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        throw new CspTrialTransportError(
          "malformed",
          "CSP trial resource is not valid UTF-8 CSV",
          null,
          { cause: error },
        );
      }
    },
  });
}

export async function previewCspSourceTrial(input: {
  manifest: SourceTrialManifest;
  resourceManifest: CspTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  fetch?: AtsTrialFetch;
  signal?: AbortSignal;
  now?: () => Date;
  runId?: string;
}): Promise<CspSourceTrialPreview> {
  const manifest = validateCspTrialInput(input);
  const transport = createCspTrialTransport(input);
  const now = input.now?.() ?? new Date();
  const csv = await transport.fetch(input.signal ?? new AbortController().signal);
  const parsed = parseCspCsv(csv, transport.resourceManifest, manifest.budget.maxCandidates);
  const evidencePage = {
    schemaVersion: "hirly.csp-evidence-page.v1",
    resourceManifest: transport.resourceManifest,
    resourceContentHash: transport.resourceManifest.contentSha256,
    resourceByteCount: transport.resourceManifest.byteLength,
    counts: parsed.counts,
    blockers: ["no_canonical_apply_route"],
    containsRawRows: false,
    containsPersonalData: false,
  };
  const serializedEvidence = stableJson(evidencePage);
  const evidenceByteCount = Buffer.byteLength(serializedEvidence, "utf8");
  const withoutDigest = {
    schemaVersion: "hirly.csp-evidence-trial-preview.v1" as const,
    runId: input.runId ?? randomUUID(),
    trialKey: manifest.trialKey,
    provider: "data_gouv" as const,
    sourceKey: `${transport.resourceManifest.datasetId}:${transport.resourceManifest.resourceId}`,
    fetchedAt: now.toISOString(),
    complete: true as const,
    requestCount: 1 as const,
    pageCount: 1 as const,
    resourceByteCount: transport.resourceManifest.byteLength,
    evidenceByteCount,
    resourceContentHash: transport.resourceManifest.contentSha256,
    resourceManifest: transport.resourceManifest,
    parsedRows: parsed.counts.parsedRows,
    normalized: parsed.candidates.length,
    rejected: parsed.counts.rejected,
    deduplicated: parsed.counts.deduplicated,
    activeAtSnapshotRows: parsed.counts.activeAtSnapshotRows,
    activeAtSnapshotUniqueReferences: parsed.counts.activeAtSnapshotUniqueReferences,
    activeAtCaptureRows: parsed.counts.activeAtCaptureRows,
    activeAtCaptureUniqueReferences: parsed.counts.activeAtCaptureUniqueReferences,
    actionable: 0 as const,
    candidates: parsed.candidates,
    evidencePage,
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

export async function persistCspSourceTrial(input: {
  manifest: SourceTrialManifest;
  resourceManifest: CspTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  repository: SourceTrialEvidenceRepository;
  fetch?: AtsTrialFetch;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<CspSourceTrialPreview> {
  const manifest = validateCspTrialInput(input);
  const runId = await input.repository.beginSourceTrial(manifest);
  let pagesFetched = 0;
  let candidatesObserved = 0;
  let bytesStored = 0;
  try {
    const preview = await previewCspSourceTrial({
      ...input,
      manifest,
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
      const serializedCandidate = stableJson(candidate);
      await input.repository.recordSourceTrialCandidate({
        runId,
        pageId,
        candidateKey: candidate.candidateKey,
        serializedCandidate,
        contentHash: sha256(serializedCandidate),
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

function validateCspTrialInput(input: {
  manifest: SourceTrialManifest;
  resourceManifest: CspTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  now?: () => Date;
}): SourceTrialManifest {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  const resource = validateApprovedManifest(input.resourceManifest, input.approvedManifestDigests);
  if (
    manifest.provider !== "data_gouv" ||
    manifest.sourceId !== resource.sourceId ||
    manifest.policyEvidenceId !== resource.policyEvidenceId ||
    manifest.tenantKey !== `${resource.datasetId}:${resource.resourceId}` ||
    manifest.countryCodes.length !== 1 ||
    manifest.countryCodes[0] !== "FR"
  ) {
    throw new Error("trial_resource_manifest_mismatch");
  }
  if (
    resource.byteLength > manifest.budget.maxBytes ||
    resource.expectedCounts.uniqueReferences > manifest.budget.maxCandidates
  ) {
    throw new Error("trial_resource_budget_exceeds_policy");
  }
  const now = input.now?.() ?? new Date();
  if (
    new Date(manifest.requestedAt).getTime() > now.getTime() ||
    new Date(manifest.expiresAt).getTime() <= now.getTime()
  ) {
    throw new Error("trial_policy_window_invalid");
  }
  return manifest;
}

function validateApprovedManifest(
  input: CspTrialResourceManifest,
  approvedManifestDigests: readonly string[],
): CspTrialResourceManifest {
  const manifest = deepFreeze(manifestSchema.parse(input));
  if (!approvedManifestDigests.includes(manifest.manifestDigest)) {
    throw new CspTrialTransportError("permanent", "CSP trial resource manifest is not allowlisted");
  }
  return manifest;
}

function parseCspCsv(
  csv: string,
  manifest: CspTrialResourceManifest,
  maxCandidates: number,
): {
  candidates: CspEvidenceCandidate[];
  counts: CspTrialResourceManifest["expectedCounts"] & {
    rejected: number;
    deduplicated: number;
  };
} {
  const rows = parseDelimitedRows(csv, ";");
  const header = rows.next().value;
  if (!header) {
    throw new CspTrialTransportError("malformed", "CSP CSV has no header");
  }
  const required = [
    "Organisme de rattachement",
    "Référence",
    "Intitulé du poste",
    "Employeur",
    "Localisation du poste",
    "Lieu d'affectation",
    "Date de début de publication par défaut",
    "Date de fin de publication par défaut",
  ] as const;
  const indexes = Object.fromEntries(
    required.map((name) => [name, header.indexOf(name)]),
  ) as Record<(typeof required)[number], number>;
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new CspTrialTransportError("malformed", "CSP CSV is missing a required evidence column");
  }

  const candidates = new Map<string, CspEvidenceCandidate>();
  const allReferences = new Set<string>();
  const snapshotDate = parseIsoDate(manifest.snapshotDate);
  const captureDate = parseIsoDate(manifest.captureDate);
  const snapshotReferences = new Set<string>();
  const captureReferences = new Set<string>();
  let parsedRows = 0;
  let rejected = 0;
  let deduplicated = 0;
  let activeAtSnapshotRows = 0;
  let activeAtCaptureRows = 0;
  for (const row of rows) {
    if (row.length === 1 && row[0] === "") continue;
    parsedRows += 1;
    const reference = cell(row, indexes["Référence"]);
    const title = cell(row, indexes["Intitulé du poste"]);
    const employer =
      cell(row, indexes["Employeur"]) || cell(row, indexes["Organisme de rattachement"]);
    const location =
      cell(row, indexes["Localisation du poste"]) || cell(row, indexes["Lieu d'affectation"]);
    const startsAt = parseFrenchDate(cell(row, indexes["Date de début de publication par défaut"]));
    const endsAt = parseFrenchDate(cell(row, indexes["Date de fin de publication par défaut"]));
    if (reference) allReferences.add(reference);
    const activeAtSnapshot = isActive(startsAt, endsAt, snapshotDate);
    const activeAtCapture = isActive(startsAt, endsAt, captureDate);
    if (activeAtSnapshot) {
      activeAtSnapshotRows += 1;
      if (reference) snapshotReferences.add(reference);
    }
    if (activeAtCapture) {
      activeAtCaptureRows += 1;
      if (reference) captureReferences.add(reference);
    }
    if (!reference || !title || !employer) {
      rejected += 1;
      continue;
    }
    const externalId = stableDataGouvExternalId(manifest.datasetId, manifest.resourceId, reference);
    const candidateKey = `data_gouv:${externalId}`;
    if (candidates.has(candidateKey)) {
      deduplicated += 1;
      continue;
    }
    if (candidates.size >= maxCandidates) {
      throw new Error("trial_budget_exceeded:maxCandidates");
    }
    const candidateWithoutHash = {
      schemaVersion: "hirly.csp-evidence-candidate.v1" as const,
      candidateKey,
      externalId,
      reference,
      title,
      employer,
      location,
      publicationStartsAt: startsAt?.toISOString() ?? null,
      publicationEndsAt: endsAt?.toISOString() ?? null,
      activeAtSnapshot,
      activeAtCapture,
      actionable: false as const,
      blocker: "no_canonical_apply_route" as const,
    };
    candidates.set(candidateKey, {
      ...candidateWithoutHash,
      contentHash: sha256(stableJson(candidateWithoutHash)),
    });
  }
  const counts = {
    parsedRows,
    uniqueReferences: allReferences.size,
    activeAtSnapshotRows,
    activeAtSnapshotUniqueReferences: snapshotReferences.size,
    activeAtCaptureRows,
    activeAtCaptureUniqueReferences: captureReferences.size,
    rejected,
    deduplicated,
  };
  for (const [key, expected] of Object.entries(manifest.expectedCounts)) {
    if (counts[key as keyof typeof counts] !== expected) {
      throw new CspTrialTransportError("malformed", `CSP CSV count mismatch:${key}`);
    }
  }
  return { candidates: [...candidates.values()], counts };
}

function* parseDelimitedRows(input: string, delimiter: string): Generator<string[]> {
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(stripCarriageReturn(field));
      yield row;
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new CspTrialTransportError("malformed", "CSP CSV ends inside a quoted field");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(stripCarriageReturn(field));
    yield row;
  }
}

function cell(row: readonly string[], index: number): string {
  return (row[index] ?? "").trim();
}

function stripCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function parseFrenchDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isActive(startsAt: Date | null, endsAt: Date | null, at: Date): boolean {
  return (
    startsAt !== null &&
    endsAt !== null &&
    startsAt.getTime() <= at.getTime() &&
    endsAt.getTime() >= at.getTime()
  );
}

async function fetchBoundedBytes(input: {
  url: URL;
  budgets: AtsTrialTransportBudgets;
  fetch: AtsTrialFetch;
  signal: AbortSignal;
}): Promise<Uint8Array> {
  if (input.signal.aborted) {
    throw new CspTrialTransportError("cancelled", "CSP trial request cancelled");
  }
  const controller = new AbortController();
  const callerAbort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", callerAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("CSP trial time budget exceeded"));
  }, input.budgets.timeoutMs);
  try {
    let response: Response;
    try {
      response = await awaitWithAbort(
        input.fetch(input.url.href, {
          method: "GET",
          headers: { accept: "text/csv" },
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        }),
        controller.signal,
      );
    } catch (error) {
      throw new CspTrialTransportError(
        input.signal.aborted ? "cancelled" : timedOut ? "budget_exceeded" : "retryable",
        "CSP trial network request failed",
        null,
        { cause: error },
      );
    }
    if (!response.ok) throw classifyStatus(response.status);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/csv")) {
      throw new CspTrialTransportError(
        "malformed",
        "CSP trial response is not CSV",
        response.status,
      );
    }
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) > input.budgets.maxBytes)
    ) {
      throw new CspTrialTransportError(
        "budget_exceeded",
        "CSP trial response exceeds its byte budget",
        response.status,
      );
    }
    if (!response.body) {
      throw new CspTrialTransportError(
        "malformed",
        "CSP trial response has no body",
        response.status,
      );
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await awaitWithAbort(reader.read(), controller.signal);
        if (done) break;
        total += value.byteLength;
        if (total > input.budgets.maxBytes) {
          await reader.cancel();
          throw new CspTrialTransportError(
            "budget_exceeded",
            "CSP trial response exceeds its byte budget",
            response.status,
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof CspTrialTransportError) throw error;
      throw new CspTrialTransportError(
        input.signal.aborted ? "cancelled" : timedOut ? "budget_exceeded" : "retryable",
        "CSP trial response body could not be read",
        response.status,
        { cause: error },
      );
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", callerAbort);
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function classifyStatus(status: number): CspTrialTransportError {
  if (status === 404 || status === 410) {
    return new CspTrialTransportError("not_found", "CSP resource not found", status);
  }
  if (status === 429) {
    return new CspTrialTransportError("rate_limited", "CSP resource request rate limited", status);
  }
  if (status >= 500) {
    return new CspTrialTransportError("retryable", "CSP resource request failed", status);
  }
  return new CspTrialTransportError("permanent", "CSP resource request rejected", status);
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
  if (error instanceof CspTrialTransportError) {
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
    return { status: "policy_expired", stopReason: "policy_expired" };
  }
  return { status: "failed", stopReason: "unclassified_failure" };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
