import { nextSproutCheckpoint, sproutCheckpointSchema, type SproutCheckpoint } from "./checkpoint";
import { assertSproutActivationReady, type SproutActivation } from "./registration";

export interface SproutRuntimePage<RawJob> {
  items: readonly RawJob[];
  next: string | number | null;
  sourceReportedTotal: number;
  responseBytes: number;
  returnedItemCount?: number;
  rejected?: number;
  watermark: string | null;
  wrapperMismatch?: boolean;
}

export interface SproutRuntimeTransport<RawJob> {
  fetchPage(
    input: {
      countryCode: string;
      offset: number;
      pageSize: number;
      credentialRef: string;
      includeUnknownWorkLocation?: boolean;
      includeQualifiedRadius?: boolean;
    },
    signal: AbortSignal,
  ): Promise<SproutRuntimePage<RawJob>>;
}

export interface SproutPageCommitRepository<RawJob> {
  commitPage(input: {
    checkpointIn: SproutCheckpoint;
    checkpointOut: SproutCheckpoint;
    items: readonly RawJob[];
    complete: boolean;
    fetchedAt: Date;
  }): Promise<{ committedCheckpoint: SproutCheckpoint; inserted: number; rejected: number }>;
}

export interface SproutPageTaskResult {
  fetched: number;
  responseBytes: number;
  complete: boolean;
  checkpoint: SproutCheckpoint;
  inserted: number;
  rejected: number;
}

export async function runSproutPageTask<RawJob>(input: {
  activation: SproutActivation;
  mode: "canary" | "backfill" | "incremental";
  checkpoint: SproutCheckpoint;
  countryCode?: string;
  transport: SproutRuntimeTransport<RawJob>;
  repository: SproutPageCommitRepository<RawJob>;
  hasCountryLocation?: (raw: RawJob, countryCode: string) => boolean;
  /** @deprecated Compatibility seam for the original FR-only runtime tests. */
  hasFranceLocation?: (raw: RawJob) => boolean;
  signal: AbortSignal;
  maxResponseBytes: number;
  includeQualifiedRadius?: boolean;
  includeUnknownWorkLocation?: boolean;
  now?: () => Date;
}): Promise<SproutPageTaskResult> {
  const activation = assertSproutActivationReady(input.activation, input.mode);
  const checkpointIn = sproutCheckpointSchema.parse(input.checkpoint);
  const countryCode = input.countryCode ?? "FR";
  const hasCountryLocation =
    input.hasCountryLocation ??
    ((raw: RawJob, candidateCountryCode: string) =>
      candidateCountryCode === "FR" && input.hasFranceLocation?.(raw) === true);
  if (input.mode === "canary" && checkpointIn.offset !== 0) {
    throw new Error("sprout_canary_must_start_at_initial_checkpoint");
  }
  if (checkpointIn.pageSize !== activation.approvedPageSize) {
    throw new Error("sprout_checkpoint_unapproved_page_size");
  }
  if (!Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 1) {
    throw new Error("sprout_runtime_invalid_byte_budget");
  }

  input.signal.throwIfAborted();
  const page = await input.transport.fetchPage(
    {
      countryCode,
      offset: checkpointIn.offset,
      pageSize: checkpointIn.pageSize,
      credentialRef: activation.credentialRef,
      includeQualifiedRadius: input.includeQualifiedRadius,
      includeUnknownWorkLocation: input.includeUnknownWorkLocation,
    },
    input.signal,
  );
  input.signal.throwIfAborted();

  if (
    !Number.isSafeInteger(page.responseBytes) ||
    page.responseBytes < 0 ||
    page.responseBytes > input.maxResponseBytes
  ) {
    throw new Error("sprout_runtime_response_budget_exceeded");
  }
  const returnedItemCount = page.returnedItemCount ?? page.items.length;
  if (!Number.isSafeInteger(returnedItemCount) || returnedItemCount < page.items.length) {
    throw new Error("sprout_runtime_invalid_returned_item_count");
  }
  if (returnedItemCount > checkpointIn.pageSize) {
    throw new Error("sprout_runtime_page_size_exceeded");
  }
  // The intentionally broad country query can include rows whose locations are
  // unknown or cross-border. They advance pagination but never cross this
  // source boundary into a canonical write.
  const countryItems = page.items.filter((raw) => hasCountryLocation(raw, countryCode));

  const advanced = nextSproutCheckpoint({
    current: checkpointIn,
    returnedItemCount,
    sourceReportedTotal: page.sourceReportedTotal,
    next: page.next,
  });
  const checkpointOut = sproutCheckpointSchema.parse({
    ...advanced.checkpoint,
    watermark: page.watermark ?? checkpointIn.watermark,
  });
  const committed = await input.repository.commitPage({
    checkpointIn,
    checkpointOut,
    items: countryItems,
    complete: advanced.complete,
    fetchedAt: input.now?.() ?? new Date(),
  });
  const committedCheckpoint = sproutCheckpointSchema.parse(committed.committedCheckpoint);
  if (!sameCheckpoint(checkpointOut, committedCheckpoint)) {
    throw new Error("sprout_runtime_checkpoint_commit_mismatch");
  }

  return {
    fetched: returnedItemCount,
    responseBytes: page.responseBytes,
    complete: advanced.complete,
    checkpoint: committedCheckpoint,
    inserted: committed.inserted,
    rejected: committed.rejected + (page.rejected ?? 0),
  };
}

function sameCheckpoint(left: SproutCheckpoint, right: SproutCheckpoint): boolean {
  return (
    left.version === right.version &&
    left.offset === right.offset &&
    left.pageSize === right.pageSize &&
    left.observedTotal === right.observedTotal &&
    left.watermark === right.watermark
  );
}
