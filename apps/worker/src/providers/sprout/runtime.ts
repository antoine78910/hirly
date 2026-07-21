import {
  nextSproutCheckpoint,
  sproutCheckpointSchema,
  type SproutCheckpoint,
} from "./checkpoint";
import {
  assertSproutActivationReady,
  type SproutActivation,
} from "./registration";

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
      countryCode: "FR";
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
  transport: SproutRuntimeTransport<RawJob>;
  repository: SproutPageCommitRepository<RawJob>;
  hasFranceLocation: (raw: RawJob) => boolean;
  signal: AbortSignal;
  maxResponseBytes: number;
  includeQualifiedRadius?: boolean;
  now?: () => Date;
}): Promise<SproutPageTaskResult> {
  const activation = assertSproutActivationReady(input.activation, input.mode);
  const checkpointIn = sproutCheckpointSchema.parse(input.checkpoint);
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
      countryCode: "FR",
      offset: checkpointIn.offset,
      pageSize: checkpointIn.pageSize,
      credentialRef: activation.credentialRef,
      includeQualifiedRadius: input.includeQualifiedRadius,
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
  if (page.items.some((raw) => !input.hasFranceLocation(raw))) {
    throw new Error("sprout_runtime_country_leak");
  }

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
    items: page.items,
    complete: advanced.complete,
    fetchedAt: input.now?.() ?? new Date(),
  });
  const committedCheckpoint = sproutCheckpointSchema.parse(
    committed.committedCheckpoint,
  );
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

function sameCheckpoint(
  left: SproutCheckpoint,
  right: SproutCheckpoint,
): boolean {
  return (
    left.version === right.version &&
    left.offset === right.offset &&
    left.pageSize === right.pageSize &&
    left.observedTotal === right.observedTotal &&
    left.watermark === right.watermark
  );
}
