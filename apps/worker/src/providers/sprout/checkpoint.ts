import { z } from "zod";

export const SPROUT_CHECKPOINT_VERSION = "sprout.offset.v1" as const;

export const sproutCheckpointSchema = z
  .object({
    version: z.literal(SPROUT_CHECKPOINT_VERSION),
    offset: z.number().int().nonnegative(),
    pageSize: z.number().int().positive().max(500),
    observedTotal: z.number().int().nonnegative().nullable(),
    watermark: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.observedTotal !== null &&
      checkpoint.offset > checkpoint.observedTotal
    ) {
      context.addIssue({
        code: "custom",
        message: "checkpoint offset cannot exceed the observed total",
        path: ["offset"],
      });
    }
  });

export type SproutCheckpoint = z.infer<typeof sproutCheckpointSchema>;

export function initialSproutCheckpoint(input: {
  approvedPageSize: number;
  watermark?: string | null;
}): SproutCheckpoint {
  return sproutCheckpointSchema.parse({
    version: SPROUT_CHECKPOINT_VERSION,
    offset: 0,
    pageSize: input.approvedPageSize,
    observedTotal: null,
    watermark: input.watermark ?? null,
  });
}

export function nextSproutCheckpoint(input: {
  current: SproutCheckpoint;
  returnedItemCount: number;
  sourceReportedTotal: number;
  next: string | number | null;
}): { checkpoint: SproutCheckpoint; complete: boolean } {
  const current = sproutCheckpointSchema.parse(input.current);
  if (!Number.isInteger(input.returnedItemCount) || input.returnedItemCount < 0) {
    throw new Error("sprout_checkpoint_invalid_returned_item_count");
  }
  if (
    !Number.isInteger(input.sourceReportedTotal) ||
    input.sourceReportedTotal < 0
  ) {
    throw new Error("sprout_checkpoint_invalid_source_total");
  }
  const expectedOffset = current.offset + input.returnedItemCount;
  const observedTotal = Math.max(current.observedTotal ?? 0, input.sourceReportedTotal, expectedOffset);

  if (input.next === null) {
    return {
      checkpoint: sproutCheckpointSchema.parse({
        ...current,
        offset: expectedOffset,
        observedTotal,
      }),
      complete: true,
    };
  }

  const nextOffset = parseSproutCheckpointOffset(input.next);
  if (input.returnedItemCount === 0 || nextOffset <= current.offset) {
    throw new Error("sprout_checkpoint_non_monotonic_offset");
  }

  return {
    checkpoint: sproutCheckpointSchema.parse({
      ...current,
      offset: nextOffset,
      observedTotal,
    }),
    complete: false,
  };
}

export function parseSproutCheckpointOffset(next: string | number): number {
  if (typeof next === "number") {
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error("sprout_checkpoint_invalid_next_offset");
    }
    return next;
  }

  const value = next.trim();
  if (/^\d+$/.test(value)) return Number(value);
  if (
    value.length === 0 ||
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    value.startsWith("//") ||
    !value.startsWith("?")
  ) {
    throw new Error("sprout_checkpoint_untrusted_next");
  }

  const parameters = new URLSearchParams(value.slice(1));
  const offsets = parameters.getAll("offset");
  if (offsets.length !== 1 || !/^\d+$/.test(offsets[0] ?? "")) {
    throw new Error("sprout_checkpoint_invalid_next_offset");
  }
  return Number(offsets[0]);
}
