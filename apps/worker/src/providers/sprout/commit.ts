import { createHash } from "node:crypto";
import type { SourcePageCommit, SourcePageCommitResult } from "@hirly/contracts";
import { classifyAtsUrl } from "@hirly/ingestion/ats";
import {
  sanitizeSourceDocument,
  selectApplyUrl,
  toCanonicalJob,
} from "@hirly/ingestion";
import { normalizeSproutJob, type NormalizedSproutJob } from "./normalization";
import type { SproutCheckpoint } from "./checkpoint";
import type { SproutRawJob } from "./schema";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeSproutApplyUrl(input: string): string {
  const url = new URL(input);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|gclid|fbclid|source|ref)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.href;
}

export function buildSproutCommitEntry(input: {
  raw: SproutRawJob;
  policyId: string;
  fetchedAt: Date;
  now?: Date;
}): SourcePageCommit["entries"][number] {
  const normalized: NormalizedSproutJob = normalizeSproutJob(
    input.raw,
    input.now ?? input.fetchedAt,
  );
  const canonical = toCanonicalJob(normalized, input.now ?? input.fetchedAt);
  const selected = selectApplyUrl(normalized.applyUrls);
  const canonicalApplyUrl = selected ? canonicalizeSproutApplyUrl(selected) : null;
  const ats = canonicalApplyUrl ? classifyAtsUrl(canonicalApplyUrl) : null;
  const sourceDocument = sanitizeSourceDocument(input.raw) as Record<string, unknown>;
  return {
    canonical,
    contentHash: createHash("sha256").update(stableJson(sourceDocument)).digest("hex"),
    fetchedAt: input.fetchedAt.toISOString(),
    sourceDocument,
    canonicalSourceUrl: null,
    canonicalApplyUrl,
    atsPostingId: ats?.postingId ?? null,
    publishedAt: normalized.postedAt,
    expiresAt: null,
    lifecycleState: canonical.applyFulfillmentStatus === "blocked_expired" ? "expired" : "active",
    attribution: {
      provider: "sprout",
      source: input.raw.source ?? null,
      sourceId: input.raw.sourceId ?? null,
    },
    policyId: input.policyId,
  };
}

export function createSproutCommitRepository(input: {
  sourceId: string;
  policyId: string;
  countryCode: "FR";
  mode: "backfill" | "incremental";
  commit(commit: SourcePageCommit): Promise<SourcePageCommitResult>;
}) {
  return {
    async commitPage(page: {
      checkpointIn: SproutCheckpoint;
      checkpointOut: SproutCheckpoint;
      items: readonly SproutRawJob[];
      complete: boolean;
      fetchedAt: Date;
    }): Promise<{ committedCheckpoint: SproutCheckpoint }> {
      const entries = page.items.map((raw) =>
        buildSproutCommitEntry({ raw, policyId: input.policyId, fetchedAt: page.fetchedAt }),
      );
      const result = await input.commit({
        sourceId: input.sourceId,
        countryCode: input.countryCode,
        mode: input.mode,
        checkpointIn: page.checkpointIn,
        checkpointOut: page.checkpointOut,
        complete: page.complete,
        entries,
      });
      return { committedCheckpoint: result.checkpoint as SproutCheckpoint };
    },
  };
}
