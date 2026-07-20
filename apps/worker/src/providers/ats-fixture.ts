import type {
  Provider,
  RateLimitConfig,
  SourceRegistryEntry,
} from "@hirly/contracts";
import {
  IngestionError,
  type SourceAdapter,
  type SourceContext,
  type SourceLifecycleEvidence,
  type SourcePage,
} from "@hirly/ingestion";

export const ATS_FIXTURE_CURSOR_VERSION = "g011-fixture-v1" as const;

export interface AtsFixtureCursor {
  version: typeof ATS_FIXTURE_CURSOR_VERSION;
  offset: number;
}

export interface AtsFixtureScope {
  sourceId: string;
  tenantKey: string;
  mode: "full" | "incremental";
}

export class AtsFixtureHttpError extends Error {
  constructor(readonly status: number) {
    super(`fixture HTTP status ${status}`);
    this.name = "AtsFixtureHttpError";
  }
}

type SourceErrorClass = ReturnType<
  SourceAdapter<unknown, AtsFixtureCursor, AtsFixtureScope>["classifyError"]
>;

export function classifyAtsSourceError(error: unknown): SourceErrorClass {
  if (error instanceof AtsFixtureHttpError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 408 || error.status >= 500) return "retryable";
    if (error.status === 401 || error.status === 403) return "authorization";
    return "permanent";
  }
  if (error instanceof SyntaxError) return "malformed";
  return "permanent";
}

export abstract class FixtureOnlyAtsSourceAdapter<RawJob>
  implements SourceAdapter<RawJob, AtsFixtureCursor, AtsFixtureScope>
{
  readonly enabled = false as const;
  readonly liveTransportReady = false as const;
  readonly access = "public_api" as const;

  constructor(
    readonly provider: Provider,
    readonly rateLimit: RateLimitConfig,
    private readonly rows: readonly RawJob[],
    private readonly fixturePolicyId: string,
  ) {}

  sourceIdentity(source: SourceRegistryEntry) {
    return {
      sourceId: source.id,
      datasetOrFeedId: `${this.provider}:${source.tenantKey ?? source.sourceKey}`,
    };
  }

  tenantIdentity(source: SourceRegistryEntry) {
    return {
      tenantKey: source.tenantKey,
      boardKey: source.tenantKey,
    };
  }

  async *discover(input: {
    source: SourceRegistryEntry;
    mode: "full" | "incremental";
    cursor: AtsFixtureCursor | null;
    signal: AbortSignal;
  }): AsyncIterable<SourcePage<RawJob, AtsFixtureCursor, AtsFixtureScope>> {
    const tenantKey = input.source.tenantKey;
    if (!tenantKey) {
      throw new IngestionError(
        "invalid_input",
        `${this.provider} fixture source requires a tenant key`,
      );
    }
    const pageSize = fixturePageSize(input.source);
    let offset = fixtureOffset(input.cursor, this.rows.length);
    if (this.rows.length === 0) {
      input.signal.throwIfAborted();
      yield {
        scope: {
          sourceId: input.source.id,
          tenantKey,
          mode: input.mode,
        },
        items: [],
        nextCursor: null,
        sourceReportedTotal: 0,
        complete: true,
        requestCount: 1,
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
              version: ATS_FIXTURE_CURSOR_VERSION,
              offset: nextOffset,
            }
          : null;
      yield {
        scope: {
          sourceId: input.source.id,
          tenantKey,
          mode: input.mode,
        },
        items: [...items],
        nextCursor,
        sourceReportedTotal: this.rows.length,
        complete: nextCursor === null,
        requestCount: 1,
        costMinor: 0,
      };
      offset = nextOffset;
    }
  }

  abstract normalize(raw: RawJob, context: SourceContext): ReturnType<
    SourceAdapter<RawJob, AtsFixtureCursor, AtsFixtureScope>["normalize"]
  >;

  validateActive(_raw: RawJob, now: Date): SourceLifecycleEvidence {
    return {
      state: "active",
      observedAt: now,
      expiresAt: null,
      reason:
        "present in a complete fixture snapshot; absence reconciliation requires a complete successful scope",
    };
  }

  classifyError(error: unknown): SourceErrorClass {
    return classifyAtsSourceError(error);
  }

  attribution(_raw: RawJob) {
    return {
      policyId: this.fixturePolicyId,
      licenceName: null,
      attributionText: null,
      sourceUrl: this.documentationUrl,
    };
  }

  protected abstract readonly documentationUrl: string;
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

function fixtureOffset(
  cursor: AtsFixtureCursor | null,
  total: number,
): number {
  if (!cursor) return 0;
  if (
    cursor.version !== ATS_FIXTURE_CURSOR_VERSION ||
    !Number.isInteger(cursor.offset) ||
    cursor.offset < 0 ||
    cursor.offset > total
  ) {
    throw new IngestionError("invalid_input", "invalid ATS fixture checkpoint");
  }
  return cursor.offset;
}
