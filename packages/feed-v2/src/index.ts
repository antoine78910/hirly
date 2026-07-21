import type { FeedEffectiveQuery } from "./explicit-query";

export const FEED_V2_CONTRACT_VERSION = "hirly.feed.v2" as const;

export type FeedEmptyReason =
  | "NO_MATCHING_INVENTORY"
  | "ALL_MATCHES_ACTIONED"
  | "ALL_MATCHES_POLICY_HIDDEN"
  | "ALL_MATCHES_BLOCKED"
  | "PROFILE_NOT_READY";

export type InventoryState =
  | "ready"
  | "matching_pending"
  | "inventory_gap"
  | "degraded";

export interface FeedAuthAssertion {
  subject: string;
  candidateId: string;
  scopes: readonly string[];
  issuedAt: string;
  expiresAt: string;
  effectiveQuery?: FeedEffectiveQuery;
}

export * from "./explicit-query";

export interface FeedCursorPosition {
  relevanceScore: number;
  canonicalGroupId: string;
}

export interface FeedCandidate {
  canonicalGroupId: string;
  preferredJobId: string;
  jobVersion: string;
  companyKey: string;
  relevanceScore: number;
  fulfillmentRoute: "auto" | "assisted" | "manual" | "blocked";
  actionExcluded: boolean;
  policyEligible: boolean;
  lifecycleEligible: boolean;
}

export interface FeedReadSnapshot {
  snapshotVersion: string;
  profileVersion: string;
  actionWatermark: string;
  queryFingerprint: string;
  profileReady: boolean;
  inventoryState: InventoryState;
  candidates: readonly FeedCandidate[];
  hasMore: boolean;
}

export interface FeedReadRepository {
  readIndexedCandidates(input: {
    candidateId: string;
    effectiveQuery: FeedEffectiveQuery | null;
    limit: number;
    after: FeedCursorPosition | null;
  }): Promise<FeedReadSnapshot>;
}

export interface FeedReadRequest {
  assertion: FeedAuthAssertion;
  cursor?: string | null;
  limit?: number;
}

export interface FeedSummary {
  evaluated: number;
  eligible: number;
  hiddenActioned: number;
  hiddenPolicy: number;
  hiddenBlocked: number;
  visibleByRoute: Record<FeedCandidate["fulfillmentRoute"], number>;
}

export interface FeedReadResponse {
  contractVersion: typeof FEED_V2_CONTRACT_VERSION;
  jobs: Array<
    Pick<
      FeedCandidate,
      | "canonicalGroupId"
      | "preferredJobId"
      | "jobVersion"
      | "relevanceScore"
      | "fulfillmentRoute"
    >
  >;
  nextCursor: string | null;
  inventoryState: InventoryState;
  emptyReason: FeedEmptyReason | null;
  matchContext: {
    snapshotVersion: string;
    profileVersion: string;
    actionWatermark: string;
    queryFingerprint: string;
  };
  summary: FeedSummary;
}

interface CursorEnvelope {
  version: 1;
  snapshotVersion: string;
  profileVersion: string;
  actionWatermark: string;
  queryFingerprint: string;
  after: FeedCursorPosition;
}

export class FeedAuthorizationError extends Error {
  constructor(message: "assertion_expired" | "feed_scope_required") {
    super(message);
    this.name = "FeedAuthorizationError";
  }
}

export class FeedCursorError extends Error {
  constructor(message: "invalid_cursor" | "stale_cursor") {
    super(message);
    this.name = "FeedCursorError";
  }
}

function encodeCursor(cursor: CursorEnvelope): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): CursorEnvelope {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CursorEnvelope>;
    if (
      parsed.version !== 1 ||
      typeof parsed.snapshotVersion !== "string" ||
      typeof parsed.profileVersion !== "string" ||
      typeof parsed.actionWatermark !== "string" ||
      typeof parsed.queryFingerprint !== "string" ||
      !parsed.after ||
      typeof parsed.after.relevanceScore !== "number" ||
      typeof parsed.after.canonicalGroupId !== "string"
    ) {
      throw new Error("invalid");
    }
    return parsed as CursorEnvelope;
  } catch {
    throw new FeedCursorError("invalid_cursor");
  }
}

function emptyReason(
  snapshot: FeedReadSnapshot,
  summary: FeedSummary,
): FeedEmptyReason {
  if (!snapshot.profileReady) return "PROFILE_NOT_READY";
  if (summary.evaluated === 0) return "NO_MATCHING_INVENTORY";
  if (summary.hiddenActioned === summary.evaluated) {
    return "ALL_MATCHES_ACTIONED";
  }
  if (summary.hiddenPolicy === summary.evaluated) {
    return "ALL_MATCHES_POLICY_HIDDEN";
  }
  if (summary.hiddenBlocked === summary.evaluated) return "ALL_MATCHES_BLOCKED";
  return "NO_MATCHING_INVENTORY";
}

export class FeedV2ReadService {
  constructor(
    private readonly repository: FeedReadRepository,
    private readonly options: {
      now?: () => Date;
      coarseLimit?: number;
      maxPerCompany?: number;
    } = {},
  ) {}

  async read(request: FeedReadRequest): Promise<FeedReadResponse> {
    const now = this.options.now?.() ?? new Date();
    if (new Date(request.assertion.expiresAt) <= now) {
      throw new FeedAuthorizationError("assertion_expired");
    }
    if (!request.assertion.scopes.includes("feed:read")) {
      throw new FeedAuthorizationError("feed_scope_required");
    }

    const limit = Math.max(1, Math.min(request.limit ?? 12, 100));
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;
    const queryFingerprint =
      request.assertion.effectiveQuery?.fingerprint ?? "candidate-profile";
    if (cursor && cursor.queryFingerprint !== queryFingerprint) {
      throw new FeedCursorError("stale_cursor");
    }
    const snapshot = await this.repository.readIndexedCandidates({
      candidateId: request.assertion.candidateId,
      effectiveQuery: request.assertion.effectiveQuery ?? null,
      limit: Math.max(limit, Math.min(this.options.coarseLimit ?? 1_000, 1_000)),
      after: cursor?.after ?? null,
    });

    if (
      cursor &&
      (cursor.snapshotVersion !== snapshot.snapshotVersion ||
        cursor.profileVersion !== snapshot.profileVersion ||
        cursor.actionWatermark !== snapshot.actionWatermark ||
        cursor.queryFingerprint !== snapshot.queryFingerprint ||
        snapshot.queryFingerprint !== queryFingerprint)
    ) {
      throw new FeedCursorError("stale_cursor");
    }

    const visibleByRoute: FeedSummary["visibleByRoute"] = {
      auto: 0,
      assisted: 0,
      manual: 0,
      blocked: 0,
    };
    const summary: FeedSummary = {
      evaluated: 0,
      eligible: 0,
      hiddenActioned: 0,
      hiddenPolicy: 0,
      hiddenBlocked: 0,
      visibleByRoute,
    };
    const jobs: FeedReadResponse["jobs"] = [];
    const companyCounts = new Map<string, number>();
    const groupIds = new Set<string>();
    const maxPerCompany = Math.max(1, this.options.maxPerCompany ?? 2);
    let lastScanned: FeedCandidate | null = null;
    let unscanned = false;

    if (snapshot.profileReady) {
      for (let index = 0; index < snapshot.candidates.length; index += 1) {
        const candidate = snapshot.candidates[index]!;
        lastScanned = candidate;
        summary.evaluated += 1;
        if (candidate.actionExcluded) {
          summary.hiddenActioned += 1;
          continue;
        }
        if (!candidate.policyEligible) {
          summary.hiddenPolicy += 1;
          continue;
        }
        if (!candidate.lifecycleEligible || candidate.fulfillmentRoute === "blocked") {
          summary.hiddenBlocked += 1;
          continue;
        }
        if (groupIds.has(candidate.canonicalGroupId)) continue;
        if ((companyCounts.get(candidate.companyKey) ?? 0) >= maxPerCompany) {
          continue;
        }
        groupIds.add(candidate.canonicalGroupId);
        companyCounts.set(
          candidate.companyKey,
          (companyCounts.get(candidate.companyKey) ?? 0) + 1,
        );
        summary.eligible += 1;
        visibleByRoute[candidate.fulfillmentRoute] += 1;
        jobs.push({
          canonicalGroupId: candidate.canonicalGroupId,
          preferredJobId: candidate.preferredJobId,
          jobVersion: candidate.jobVersion,
          relevanceScore: candidate.relevanceScore,
          fulfillmentRoute: candidate.fulfillmentRoute,
        });
        if (jobs.length === limit) {
          unscanned = index < snapshot.candidates.length - 1;
          break;
        }
      }
    }

    const nextCursor =
      lastScanned && (unscanned || snapshot.hasMore)
        ? encodeCursor({
            version: 1,
            snapshotVersion: snapshot.snapshotVersion,
            profileVersion: snapshot.profileVersion,
            actionWatermark: snapshot.actionWatermark,
            queryFingerprint: snapshot.queryFingerprint,
            after: {
              relevanceScore: lastScanned.relevanceScore,
              canonicalGroupId: lastScanned.canonicalGroupId,
            },
          })
        : null;

    return {
      contractVersion: FEED_V2_CONTRACT_VERSION,
      jobs,
      nextCursor,
      inventoryState: snapshot.inventoryState,
      emptyReason: jobs.length === 0 ? emptyReason(snapshot, summary) : null,
      matchContext: {
        snapshotVersion: snapshot.snapshotVersion,
        profileVersion: snapshot.profileVersion,
        actionWatermark: snapshot.actionWatermark,
        queryFingerprint: snapshot.queryFingerprint,
      },
      summary,
    };
  }
}
