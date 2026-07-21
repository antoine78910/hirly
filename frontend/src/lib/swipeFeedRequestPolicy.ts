export type SwipeFeedEmptyReason =
  | "NO_MATCHING_INVENTORY"
  | "MATCHING_PENDING"
  | "PROJECTION_LAG"
  | "ALL_MATCHES_ACTIONED"
  | "ALL_MATCHES_POLICY_HIDDEN"
  | "ALL_MATCHES_BLOCKED"
  | "PROFILE_NOT_READY"
  | "SERVICE_DEGRADED";

export type SwipeFeedViewState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "projection_lag"; emptyReason: SwipeFeedEmptyReason }
  | { kind: "empty"; emptyReason: SwipeFeedEmptyReason | null }
  | { kind: "error"; emptyReason: SwipeFeedEmptyReason | null };

type FeedMeta = {
  inventoryState?: string;
  inventory_state?: string;
  emptyReason?: SwipeFeedEmptyReason | null;
  empty_reason?: SwipeFeedEmptyReason | { code?: SwipeFeedEmptyReason } | null;
};

function emptyReason(meta: FeedMeta | null | undefined): SwipeFeedEmptyReason | null {
  if (typeof meta?.emptyReason === "string") return meta.emptyReason;
  if (typeof meta?.empty_reason === "string") return meta.empty_reason;
  if (meta?.empty_reason && typeof meta.empty_reason === "object") {
    return meta.empty_reason.code ?? null;
  }
  return null;
}

export function resolveSwipeFeedViewState(input: {
  loading: boolean;
  jobCount: number;
  feedMeta?: FeedMeta | null;
  feedError?: string | null;
}): SwipeFeedViewState {
  if (input.loading && input.jobCount === 0) return { kind: "loading" };
  if (input.jobCount > 0) return { kind: "ready" };
  const reason = emptyReason(input.feedMeta);
  const inventoryState = input.feedMeta?.inventoryState ?? input.feedMeta?.inventory_state;
  if (
    inventoryState === "matching_pending"
    || reason === "MATCHING_PENDING"
    || reason === "PROJECTION_LAG"
  ) {
    return { kind: "projection_lag", emptyReason: reason ?? "PROJECTION_LAG" };
  }
  if (input.feedError || inventoryState === "degraded" || reason === "SERVICE_DEGRADED") {
    return { kind: "error", emptyReason: reason };
  }
  return { kind: "empty", emptyReason: reason };
}

export function sanitizeSwipeFeedParams(params: URLSearchParams): URLSearchParams {
  const safe = new URLSearchParams(params);
  for (const key of [
    "prefetch",
    "refresh",
    "provider_refresh",
    "background_refresh",
  ]) {
    safe.delete(key);
  }
  return safe;
}

export function createInitialSwipeFeedRequestGate() {
  let claimedIdentity: string | null = null;
  return {
    claim(identity: string): boolean {
      if (claimedIdentity === identity) return false;
      claimedIdentity = identity;
      return true;
    },
  };
}

export function createSwipeFeedRequestFence() {
  let currentRequestId = 0;
  return {
    next() {
      currentRequestId += 1;
      const requestId = currentRequestId;
      return {
        requestId,
        isCurrent: () => requestId === currentRequestId,
      };
    },
  };
}
