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
  watermark: string | null;
}

export interface SproutRuntimeTransport<RawJob> {
  fetchPage(
    input: {
      countryCode: "FR";
      offset: number;
      pageSize: number;
      credentialRef: string;
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
  }): Promise<{ committedCheckpoint: SproutCheckpoint }>;
}

export interface SproutPageTaskResult {
  fetched: number;
  responseBytes: number;
  complete: boolean;
  checkpoint: SproutCheckpoint;
}

export async function runSproutPageTask<RawJob>(input: {
  activation: SproutActivation;
  mode: "backfill" | "incremental";
  checkpoint: SproutCheckpoint;
  transport: SproutRuntimeTransport<RawJob>;
  repository: SproutPageCommitRepository<RawJob>;
  hasFranceLocation: (raw: RawJob) => boolean;
  signal: AbortSignal;
  maxResponseBytes: number;
  now?: () => Date;
}): Promise<SproutPageTaskResult> {
  const activation = assertSproutActivationReady(input.activation, input.mode);
  const checkpointIn = sproutCheckpointSchema.parse(input.checkpoint);
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
  if (page.items.length > checkpointIn.pageSize) {
    throw new Error("sprout_runtime_page_size_exceeded");
  }
  if (page.items.some((raw) => !input.hasFranceLocation(raw))) {
    throw new Error("sprout_runtime_country_leak");
  }

  const advanced = nextSproutCheckpoint({
    current: checkpointIn,
    returnedItemCount: page.items.length,
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
    fetched: page.items.length,
    responseBytes: page.responseBytes,
    complete: advanced.complete,
    checkpoint: committedCheckpoint,
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
