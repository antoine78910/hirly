import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  sourceTrialBudgetStopReasonSchema,
  sourceTrialManifestSchema,
  sourceTrialResultSchema,
  type CanonicalJob,
  type SourceRegistryEntry,
  type SourceTrialManifest,
  type SourceTrialResult,
} from "@hirly/contracts";
import {
  FixtureOnlyDataGouvSourceAdapter,
  type DataGouvRawJob,
} from "@hirly/ingestion/data-gouv";
import {
  sanitizeSourceDocument,
  toCanonicalJob,
  type SourceContext,
} from "@hirly/ingestion";
import {
  AtsTrialTransportError,
  fetchBoundedAtsJson,
  type AtsTrialFetch,
} from "./providers/ats-trial-transport";
import type { SourceTrialEvidenceRepository } from "./source-trial";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const identityPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[^:]+$/, "data.gouv trial identifiers must not contain colons");
const officialDataGouvUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["www.data.gouv.fr", "static.data.gouv.fr"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search
  ) {
    context.addIssue({
      code: "custom",
      message: "data.gouv trial URL must be an official credential-free HTTPS resource",
    });
  }
});

const disabledFlagsSchema = z
  .object({
    enabled: z.literal(false),
    transportEnabled: z.literal(false),
    incrementalEnabled: z.literal(false),
    backfillEnabled: z.literal(false),
  })
  .strict();

const qualificationSchema = z
  .object({
    schemaVersion: z.literal("data-gouv-qualification.v1"),
    datasetId: identityPartSchema,
    resourceId: identityPartSchema,
    evaluatedAt: z.iso.datetime({ offset: true }),
    decision: z.literal("qualified"),
    blockReasons: z.array(z.never()).length(0),
    evidenceDigest: sha256Schema,
    activationDefaults: disabledFlagsSchema,
  })
  .strict();

const dataGouvTrialResourceManifestBaseSchema = z
  .object({
    schemaVersion: z.literal("hirly.data-gouv-trial-resource.v1"),
    sourceId: z.uuid(),
    policyEvidenceId: z.uuid(),
    datasetId: identityPartSchema,
    resourceId: identityPartSchema,
    resourceUrl: officialDataGouvUrlSchema,
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(250),
    policyArtifactDigest: sha256Schema,
    qualification: qualificationSchema,
    attribution: z
      .object({
        licenceName: z.string().trim().min(1).max(256),
        attributionText: z.string().trim().min(1).max(2_000),
        sourceUrl: officialDataGouvUrlSchema,
      })
      .strict(),
    budgets: z
      .object({
        maxRequests: z.literal(1),
        maxPages: z.literal(1),
        maxBytes: z.number().int().positive().max(10_000_000),
        timeoutMs: z.number().int().positive().max(60_000),
      })
      .strict(),
  })
  .strict();

function validateResourceManifestBinding(
  value: z.output<typeof dataGouvTrialResourceManifestBaseSchema>,
  context: z.core.$RefinementCtx<
    z.output<typeof dataGouvTrialResourceManifestBaseSchema>
  >,
): void {
    if (
      value.qualification.datasetId !== value.datasetId ||
      value.qualification.resourceId !== value.resourceId
    ) {
      context.addIssue({
        code: "custom",
        message: "data.gouv qualification must bind the exact trial resource",
        path: ["qualification"],
      });
    }
    if (new Set(value.countryCodes).size !== value.countryCodes.length) {
      context.addIssue({
        code: "custom",
        message: "data.gouv trial country codes must be unique",
        path: ["countryCodes"],
      });
    }
}

const dataGouvTrialResourceManifestInputSchema =
  dataGouvTrialResourceManifestBaseSchema.superRefine(
    validateResourceManifestBinding,
  );

const dataGouvTrialResourceManifestSchema =
  dataGouvTrialResourceManifestBaseSchema
    .extend({ manifestDigest: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      validateResourceManifestBinding(value, context);
      const { manifestDigest: _manifestDigest, ...unsigned } = value;
      if (sha256(stableJson(unsigned)) !== value.manifestDigest) {
        context.addIssue({
          code: "custom",
          message: "data.gouv trial resource manifest digest mismatch",
          path: ["manifestDigest"],
        });
      }
    });

const dataGouvRawJobSchema = z
  .object({
    datasetId: identityPartSchema,
    resourceId: identityPartSchema,
    recordId: identityPartSchema,
    title: z.string().trim().min(1).max(512),
    employer: z.string().trim().min(1).max(512),
    location: z.string().trim().min(1).max(512),
    countryCode: z.string().trim().min(2).max(64),
    description: z.string().max(100_000),
    contractType: z.string().trim().min(1).max(128).nullable(),
    status: z.string().trim().min(1).max(64).nullable(),
    applyUrls: z.array(z.url()).min(1).max(10),
    sourceUrl: officialDataGouvUrlSchema,
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    sourceDocument: z.record(z.string(), z.unknown()),
  })
  .strict();

const dataGouvTrialSnapshotSchema = z
  .object({
    schemaVersion: z.literal("hirly.data-gouv-trial-snapshot.v1"),
    datasetId: identityPartSchema,
    resourceId: identityPartSchema,
    rows: z.array(dataGouvRawJobSchema).max(1_000_000),
  })
  .strict();

export type DataGouvTrialResourceManifestInput = z.input<
  typeof dataGouvTrialResourceManifestInputSchema
>;
export type DataGouvTrialResourceManifest = z.output<
  typeof dataGouvTrialResourceManifestSchema
>;
export type DataGouvTrialSnapshot = z.output<
  typeof dataGouvTrialSnapshotSchema
>;

export interface DataGouvTrialCandidate {
  candidateKey: string;
  contentHash: string;
  candidate: CanonicalJob;
}

export interface DataGouvSourceTrialPreview {
  schemaVersion: "hirly.data-gouv-source-trial-preview.v1";
  runId: string;
  trialKey: string;
  provider: "data_gouv";
  sourceKey: string;
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
  resourceManifest: DataGouvTrialResourceManifest;
  rawPage: unknown;
  candidates: DataGouvTrialCandidate[];
  safeguards: {
    canonicalWrites: false;
    applicationWrites: false;
    queueWrites: false;
    providerOwnershipChanges: false;
    sourceActivationChanges: false;
  };
  digest: string;
}

export const cspDataGouvTrialReadiness = Object.freeze({
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
  policyArtifact:
    "artifacts/job-ingestion/source-policy/g016-official-access-2026-07-20.json",
  transportModule: "./csp-source-trial",
} as const);

export function sealDataGouvTrialResourceManifest(
  input: DataGouvTrialResourceManifestInput,
): DataGouvTrialResourceManifest {
  const parsed = dataGouvTrialResourceManifestInputSchema.parse(input);
  return deepFreeze(
    dataGouvTrialResourceManifestSchema.parse({
      ...parsed,
      manifestDigest: sha256(stableJson(parsed)),
    }),
  );
}

export interface QualifiedDataGouvTrialTransport {
  readonly trialOnly: true;
  readonly manualInvocationOnly: true;
  readonly liveTransportReady: false;
  readonly canonicalWriteReady: false;
  readonly credentialsAccepted: false;
  readonly resourceManifest: DataGouvTrialResourceManifest;
  fetch(signal: AbortSignal): Promise<DataGouvTrialSnapshot>;
}

export function createQualifiedDataGouvTrialTransport(input: {
  resourceManifest: DataGouvTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  fetch?: AtsTrialFetch;
}): QualifiedDataGouvTrialTransport {
  const resourceManifest = deepFreeze(
    dataGouvTrialResourceManifestSchema.parse(input.resourceManifest),
  );
  if (!input.approvedManifestDigests.includes(resourceManifest.manifestDigest)) {
    throw new AtsTrialTransportError(
      "permanent",
      "data.gouv trial resource manifest is not allowlisted",
    );
  }
  const resourceUrl = new URL(resourceManifest.resourceUrl);
  const fetch = input.fetch ?? globalThis.fetch;
  return Object.freeze({
    trialOnly: true as const,
    manualInvocationOnly: true as const,
    liveTransportReady: false as const,
    canonicalWriteReady: false as const,
    credentialsAccepted: false as const,
    resourceManifest,
    async fetch(signal: AbortSignal): Promise<DataGouvTrialSnapshot> {
      const snapshot = await fetchBoundedAtsJson({
        url: resourceUrl,
        allowedHost: resourceUrl.hostname,
        fetch,
        budgets: resourceManifest.budgets,
        schema: dataGouvTrialSnapshotSchema,
        signal,
      });
      if (
        snapshot.datasetId !== resourceManifest.datasetId ||
        snapshot.resourceId !== resourceManifest.resourceId ||
        snapshot.rows.some(
          (row) =>
            row.datasetId !== resourceManifest.datasetId ||
            row.resourceId !== resourceManifest.resourceId,
        )
      ) {
        throw new AtsTrialTransportError(
          "malformed",
          "data.gouv trial snapshot does not match the allowlisted resource",
        );
      }
      return snapshot;
    },
  });
}

export async function previewDataGouvSourceTrial(input: {
  manifest: SourceTrialManifest;
  resourceManifest: DataGouvTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  fetch?: AtsTrialFetch;
  signal?: AbortSignal;
  now?: () => Date;
  runId?: string;
}): Promise<DataGouvSourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  const now = input.now?.() ?? new Date();
  assertTrialBinding(manifest, input.resourceManifest, now);
  const transport = createQualifiedDataGouvTrialTransport(input);
  const snapshot = await transport.fetch(
    input.signal ?? new AbortController().signal,
  );
  if (snapshot.rows.length > manifest.budget.maxCandidates) {
    throw new Error("trial_budget_exceeded:maxCandidates");
  }
  const rawPage = sanitizeSourceDocument({
    resourceManifest: transport.resourceManifest,
    snapshot,
  });
  const serializedPage = stableJson(rawPage);
  const byteCount = Buffer.byteLength(serializedPage, "utf8");
  if (byteCount > manifest.budget.maxBytes) {
    throw new Error("trial_budget_exceeded:maxBytes");
  }

  const adapter = new FixtureOnlyDataGouvSourceAdapter(snapshot.rows, {
    policyId: manifest.policyEvidenceId,
    licenceName: transport.resourceManifest.attribution.licenceName,
    attributionText: transport.resourceManifest.attribution.attributionText,
    sourceUrl: transport.resourceManifest.attribution.sourceUrl,
  });
  const source = disabledSource(manifest, transport.resourceManifest);
  const context: SourceContext = {
    source,
    runId: input.runId ?? randomUUID(),
    fetchedAt: now,
  };
  const candidates: DataGouvTrialCandidate[] = [];
  const identities = new Set<string>();
  let rejected = 0;
  let deduplicated = 0;
  for (const raw of snapshot.rows) {
    try {
      const occurrence = adapter.normalize(raw, context);
      const canonical = toCanonicalJob(occurrence.job, now);
      const candidateKey = `${canonical.provider}:${canonical.externalId}`;
      if (identities.has(candidateKey)) {
        deduplicated += 1;
        continue;
      }
      identities.add(candidateKey);
      candidates.push({
        candidateKey,
        contentHash: sha256(stableJson(canonical)),
        candidate: canonical,
      });
    } catch {
      rejected += 1;
    }
  }

  const withoutDigest = {
    schemaVersion: "hirly.data-gouv-source-trial-preview.v1" as const,
    runId: context.runId,
    trialKey: manifest.trialKey,
    provider: "data_gouv" as const,
    sourceKey: source.sourceKey,
    fetchedAt: now.toISOString(),
    complete: true as const,
    requestCount: 1 as const,
    pageCount: 1 as const,
    byteCount,
    fetched: snapshot.rows.length,
    normalized: candidates.length,
    rejected,
    deduplicated,
    pageContentHash: sha256(serializedPage),
    resourceManifest: transport.resourceManifest,
    rawPage,
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

export async function persistDataGouvSourceTrial(input: {
  manifest: SourceTrialManifest;
  resourceManifest: DataGouvTrialResourceManifest;
  approvedManifestDigests: readonly string[];
  repository: SourceTrialEvidenceRepository;
  fetch?: AtsTrialFetch;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<DataGouvSourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(input.manifest);
  const admittedAt = input.now?.() ?? new Date();
  assertTrialBinding(manifest, input.resourceManifest, admittedAt);
  createQualifiedDataGouvTrialTransport({
    resourceManifest: input.resourceManifest,
    approvedManifestDigests: input.approvedManifestDigests,
    fetch: input.fetch,
  });
  const runId = await input.repository.beginSourceTrial(manifest);
  let pagesFetched = 0;
  let candidatesObserved = 0;
  let bytesStored = 0;
  try {
    const preview = await previewDataGouvSourceTrial({
      ...input,
      manifest,
      now: () => admittedAt,
      runId,
    });
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

function assertTrialBinding(
  manifest: SourceTrialManifest,
  resourceManifest: DataGouvTrialResourceManifest,
  now: Date,
): void {
  if (manifest.provider !== "data_gouv") {
    throw new Error(`trial_provider_not_ready:${manifest.provider}`);
  }
  const parsed = dataGouvTrialResourceManifestSchema.parse(resourceManifest);
  const sourceKey = `${parsed.datasetId}:${parsed.resourceId}`;
  if (
    manifest.sourceId !== parsed.sourceId ||
    manifest.policyEvidenceId !== parsed.policyEvidenceId ||
    manifest.tenantKey !== sourceKey ||
    stableJson(manifest.countryCodes) !== stableJson(parsed.countryCodes)
  ) {
    throw new Error("trial_resource_manifest_mismatch");
  }
  if (parsed.budgets.maxBytes > manifest.budget.maxBytes) {
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

function disabledSource(
  manifest: SourceTrialManifest,
  resourceManifest: DataGouvTrialResourceManifest,
): SourceRegistryEntry {
  return {
    id: manifest.sourceId,
    provider: "data_gouv",
    sourceKey: `${resourceManifest.datasetId}:${resourceManifest.resourceId}`,
    tenantKey: manifest.tenantKey,
    countryCodes: [...manifest.countryCodes],
    accessType: "open_data",
    policyId: manifest.policyEvidenceId,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    checkpoint: {},
  };
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
