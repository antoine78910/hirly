import { createHash } from "node:crypto";
import type { SourceRegistryEntry } from "@hirly/contracts";
import {
  IngestionError,
  normalizeCountryCode,
  sanitizeSourceDocument,
  selectApplyUrl,
  type AttributionMetadata,
  type NormalizedOccurrence,
  type SourceAdapter,
  type SourceContext,
  type SourceLifecycleEvidence,
  type SourcePage,
} from "./index";

export const DATA_GOUV_FIXTURE_CURSOR_VERSION = "data-gouv-fixture.v1" as const;

export interface DataGouvFixtureCursor {
  version: typeof DATA_GOUV_FIXTURE_CURSOR_VERSION;
  offset: number;
  snapshotDigest: string;
}

export interface DataGouvFixtureScope {
  sourceId: string;
  datasetId: string;
  resourceId: string;
  snapshotDigest: string;
  mode: "full" | "incremental";
}

export interface DataGouvRawJob {
  datasetId: string;
  resourceId: string;
  recordId: string;
  title: string;
  employer: string;
  location: string;
  countryCode: string;
  description: string;
  contractType: string | null;
  status: string | null;
  applyUrls: string[];
  sourceUrl: string;
  publishedAt: string | null;
  expiresAt: string | null;
  sourceDocument: Record<string, unknown>;
}

export interface DataGouvAttribution {
  policyId: string;
  licenceName: string | null;
  attributionText: string | null;
  sourceUrl: string;
}

export class DataGouvFixtureHttpError extends Error {
  constructor(readonly status: number) {
    super(`fixture HTTP status ${status}`);
    this.name = "DataGouvFixtureHttpError";
  }
}

export function dataGouvHttpsUrlIssue(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an absolute URL";
  }
  if (url.protocol !== "https:") return "must use HTTPS";
  if (url.username.length > 0 || url.password.length > 0) {
    return "must not contain credentials";
  }
  return null;
}

export function requireSafeDataGouvHttpsUrl(value: string, label: string): string {
  const issue = dataGouvHttpsUrlIssue(value);
  if (issue) {
    throw new IngestionError("invalid_input", `${label} ${issue}`);
  }
  return value;
}

type SourceErrorClass = ReturnType<
  SourceAdapter<DataGouvRawJob, DataGouvFixtureCursor, DataGouvFixtureScope>["classifyError"]
>;

export function classifyDataGouvSourceError(error: unknown): SourceErrorClass {
  if (error instanceof DataGouvFixtureHttpError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 408 || error.status >= 500) return "retryable";
    if (error.status === 401 || error.status === 403) {
      return "authorization";
    }
    return "permanent";
  }
  if (error instanceof SyntaxError) return "malformed";
  return "permanent";
}

function identityPart(label: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || normalized.includes(":")) {
    throw new IngestionError(
      "invalid_input",
      `${label} must be a non-empty colon-free stable identifier`,
    );
  }
  return normalized;
}

export function stableDataGouvExternalId(
  datasetId: string,
  resourceId: string,
  recordId: string,
): string {
  return [
    identityPart("datasetId", datasetId),
    identityPart("resourceId", resourceId),
    identityPart("recordId", recordId),
  ].join(":");
}

function fixturePageSize(source: SourceRegistryEntry): number {
  const configured = source.checkpoint?.fixturePageSize;
  return typeof configured === "number" &&
    Number.isInteger(configured) &&
    configured > 0 &&
    configured <= 500
    ? configured
    : 100;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableSnapshotDigest(rows: readonly DataGouvRawJob[]): string {
  return createHash("sha256").update(canonicalJson(rows), "utf8").digest("hex");
}

export type DisabledDataGouvSourceAdapter<RawJob extends DataGouvRawJob = DataGouvRawJob> =
  SourceAdapter<RawJob, DataGouvFixtureCursor, DataGouvFixtureScope> & {
    readonly canonicalWriteReady: false;
    readonly sourcePolicyEligible: false;
  };

export class FixtureOnlyDataGouvSourceAdapter<RawJob extends DataGouvRawJob = DataGouvRawJob>
  implements SourceAdapter<RawJob, DataGouvFixtureCursor, DataGouvFixtureScope>
{
  readonly provider = "data_gouv" as const;
  readonly enabled = false as const;
  readonly liveTransportReady = false as const;
  readonly canonicalWriteReady = false as const;
  readonly sourcePolicyEligible = false as const;
  readonly access = "open_data" as const;
  private readonly snapshotDigest: string;
  private readonly datasetId: string;
  private readonly resourceId: string;

  constructor(
    private readonly rows: readonly RawJob[],
    private readonly attributionMetadata: DataGouvAttribution,
  ) {
    const first = rows[0];
    this.datasetId = first?.datasetId ?? "empty-fixture";
    this.resourceId = first?.resourceId ?? "empty-fixture";
    for (const row of rows) {
      if (row.datasetId !== this.datasetId || row.resourceId !== this.resourceId) {
        throw new IngestionError(
          "invalid_input",
          "a data.gouv fixture adapter must bind exactly one dataset resource",
        );
      }
      stableDataGouvExternalId(row.datasetId, row.resourceId, row.recordId);
      requireSafeDataGouvHttpsUrl(row.sourceUrl, "data.gouv source URL");
      for (const applyUrl of row.applyUrls) {
        requireSafeDataGouvHttpsUrl(applyUrl, "data.gouv apply URL");
      }
    }
    this.snapshotDigest = stableSnapshotDigest(rows);
  }

  sourceIdentity(source: SourceRegistryEntry) {
    this.assertSource(source);
    return {
      sourceId: source.id,
      datasetOrFeedId: `${this.datasetId}:${this.resourceId}`,
    };
  }

  tenantIdentity(source: SourceRegistryEntry) {
    this.assertSource(source);
    return {
      tenantKey: source.tenantKey,
      boardKey: this.resourceId,
    };
  }

  async *discover(input: {
    source: SourceRegistryEntry;
    mode: "full" | "incremental";
    cursor: DataGouvFixtureCursor | null;
    signal: AbortSignal;
  }): AsyncIterable<SourcePage<RawJob, DataGouvFixtureCursor, DataGouvFixtureScope>> {
    this.assertSource(input.source);
    const pageSize = fixturePageSize(input.source);
    let offset = this.cursorOffset(input.cursor);
    const scope: DataGouvFixtureScope = {
      sourceId: input.source.id,
      datasetId: this.datasetId,
      resourceId: this.resourceId,
      snapshotDigest: this.snapshotDigest,
      mode: input.mode,
    };
    if (this.rows.length === 0) {
      input.signal.throwIfAborted();
      yield {
        scope,
        items: [],
        nextCursor: null,
        sourceReportedTotal: 0,
        complete: true,
        requestCount: 0,
        costMinor: 0,
      };
      return;
    }
    while (offset < this.rows.length) {
      input.signal.throwIfAborted();
      const items = this.rows.slice(offset, offset + pageSize);
      const nextOffset = offset + items.length;
      const nextCursor =
        nextOffset < this.rows.length
          ? {
              version: DATA_GOUV_FIXTURE_CURSOR_VERSION,
              offset: nextOffset,
              snapshotDigest: this.snapshotDigest,
            }
          : null;
      yield {
        scope,
        items: [...items],
        nextCursor,
        sourceReportedTotal: this.rows.length,
        complete: nextCursor === null,
        requestCount: 0,
        costMinor: 0,
      };
      offset = nextOffset;
    }
  }

  normalize(raw: RawJob, context: SourceContext): NormalizedOccurrence {
    this.assertSource(context.source);
    this.assertRow(raw);
    const externalId = stableDataGouvExternalId(raw.datasetId, raw.resourceId, raw.recordId);
    const countryCode = normalizeCountryCode(raw.countryCode);
    if (!context.source.countryCodes.includes(countryCode)) {
      throw new IngestionError(
        "invalid_input",
        "data.gouv fixture row country is outside the bound source countries",
      );
    }
    return {
      externalId,
      canonicalSourceUrl: raw.sourceUrl,
      canonicalApplyUrl: selectApplyUrl(raw.applyUrls),
      atsPostingId: null,
      job: {
        envelope: {
          provider: this.provider,
          externalId,
          payload: {
            datasetId: raw.datasetId,
            resourceId: raw.resourceId,
            recordId: raw.recordId,
            sourceUrl: raw.sourceUrl,
            publishedAt: raw.publishedAt,
            expiresAt: raw.expiresAt,
            sourceDocument: sanitizeSourceDocument(raw.sourceDocument),
          },
        },
        title: raw.title,
        company: raw.employer,
        location: raw.location,
        countryCode,
        description: raw.description,
        contractType: raw.contractType,
        status: raw.status,
        applyUrls: [...raw.applyUrls],
      },
    };
  }

  validateActive(raw: RawJob, now: Date): SourceLifecycleEvidence {
    this.assertRow(raw);
    const explicitExpiry = raw.expiresAt ? new Date(raw.expiresAt) : null;
    if (
      ["expired", "closed", "inactive", "archived"].includes(raw.status?.toLowerCase() ?? "") ||
      (explicitExpiry !== null &&
        !Number.isNaN(explicitExpiry.getTime()) &&
        explicitExpiry.getTime() <= now.getTime())
    ) {
      return {
        state: "expired",
        observedAt: now,
        expiresAt: explicitExpiry,
        reason: "fixture record contains explicit closed or expiry evidence",
      };
    }
    return {
      state: "active",
      observedAt: now,
      expiresAt: explicitExpiry,
      reason:
        "present in a complete immutable fixture snapshot; absence reconciliation requires a complete successful resource scope",
    };
  }

  classifyError(error: unknown): SourceErrorClass {
    return classifyDataGouvSourceError(error);
  }

  attribution(_raw: RawJob): AttributionMetadata {
    return { ...this.attributionMetadata };
  }

  private assertSource(source: SourceRegistryEntry): void {
    if (
      source.provider !== this.provider ||
      source.accessType !== this.access ||
      source.sourceKey !== `${this.datasetId}:${this.resourceId}` ||
      source.policyId !== this.attributionMetadata.policyId ||
      source.enabled ||
      source.transportEnabled ||
      source.incrementalEnabled ||
      source.backfillEnabled
    ) {
      throw new IngestionError(
        "invalid_input",
        "data.gouv fixture sources must match the bound resource and policy, use open_data access, and keep every mode disabled",
      );
    }
  }

  private assertRow(raw: DataGouvRawJob): void {
    if (raw.datasetId !== this.datasetId || raw.resourceId !== this.resourceId) {
      throw new IngestionError(
        "invalid_input",
        "data.gouv fixture row does not match the bound dataset resource",
      );
    }
  }

  private cursorOffset(cursor: DataGouvFixtureCursor | null): number {
    if (!cursor) return 0;
    if (
      cursor.version !== DATA_GOUV_FIXTURE_CURSOR_VERSION ||
      cursor.snapshotDigest !== this.snapshotDigest ||
      !Number.isInteger(cursor.offset) ||
      cursor.offset < 0 ||
      cursor.offset > this.rows.length
    ) {
      throw new IngestionError("invalid_input", "invalid or stale data.gouv fixture checkpoint");
    }
    return cursor.offset;
  }
}
