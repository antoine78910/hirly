export type SwipeFeedEmptyReason =
  | "NO_MATCHING_INVENTORY"
  | "MATCHING_PENDING"
  | "PROJECTION_LAG"
  | "ALL_MATCHES_ACTIONED"
  | "ALL_MATCHES_POLICY_HIDDEN"
  | "ALL_MATCHES_BLOCKED"
  | "PROFILE_NOT_READY"
  | "SERVICE_DEGRADED";

const SWIPE_FEED_EMPTY_REASONS = new Set<SwipeFeedEmptyReason>([
  "NO_MATCHING_INVENTORY",
  "MATCHING_PENDING",
  "PROJECTION_LAG",
  "ALL_MATCHES_ACTIONED",
  "ALL_MATCHES_POLICY_HIDDEN",
  "ALL_MATCHES_BLOCKED",
  "PROFILE_NOT_READY",
  "SERVICE_DEGRADED",
]);

export type SwipeFeedViewState =
  | { kind: "loading_initial" }
  | { kind: "loading_next_page" }
  | { kind: "ready" }
  | { kind: "projection_lag"; emptyReason: SwipeFeedEmptyReason }
  | { kind: "exhausted"; emptyReason: "ALL_MATCHES_ACTIONED" }
  | { kind: "policy_hidden"; emptyReason: "ALL_MATCHES_POLICY_HIDDEN" }
  | { kind: "blocked"; emptyReason: "ALL_MATCHES_BLOCKED" }
  | { kind: "no_inventory"; emptyReason: "NO_MATCHING_INVENTORY" | null }
  | { kind: "profile_not_ready"; emptyReason: "PROFILE_NOT_READY" }
  | { kind: "legacy_empty"; emptyReason: SwipeFeedEmptyReason | null }
  | { kind: "error"; emptyReason: SwipeFeedEmptyReason | null };

export const SWIPE_FEED_PREFETCH_THRESHOLD = 7;

/** Keeps a card runway while consuming cursor pages. */
export function shouldPrefetchSwipeFeedPage(input: {
  nextCursor?: string | null;
  remainingJobs: number;
  inFlightCursor?: string | null;
}): boolean {
  return Boolean(
    input.nextCursor
    && input.remainingJobs <= SWIPE_FEED_PREFETCH_THRESHOLD
    && input.inFlightCursor !== input.nextCursor,
  );
}

type FeedMeta = {
  inventoryState?: string;
  inventory_state?: string;
  emptyReason?: SwipeFeedEmptyReason | null;
  empty_reason?: SwipeFeedEmptyReason | { code?: SwipeFeedEmptyReason } | null;
};

function toEmptyReason(value: unknown): SwipeFeedEmptyReason | null {
  return typeof value === "string" && SWIPE_FEED_EMPTY_REASONS.has(value as SwipeFeedEmptyReason)
    ? value as SwipeFeedEmptyReason
    : null;
}

function emptyReason(meta: FeedMeta | null | undefined): SwipeFeedEmptyReason | null {
  if (typeof meta?.emptyReason === "string") return toEmptyReason(meta.emptyReason);
  if (typeof meta?.empty_reason === "string") return toEmptyReason(meta.empty_reason);
  if (meta?.empty_reason && typeof meta.empty_reason === "object") {
    return toEmptyReason(meta.empty_reason.code);
  }
  return null;
}

export function resolveSwipeFeedViewState(input: {
  loading?: boolean;
  loadingInitial?: boolean;
  loadingNextPage?: boolean;
  jobCount: number;
  /** A non-null cursor means the committed feed can still yield another page. */
  nextCursor?: string | null;
  feedMeta?: FeedMeta | null;
  feedError?: string | null;
}): SwipeFeedViewState {
  const loadingInitial = input.loadingInitial ?? input.loading ?? false;
  if (loadingInitial && input.jobCount === 0) return { kind: "loading_initial" };
  if (input.loadingNextPage) return { kind: "loading_next_page" };
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
  // Never infer a terminal state while another cursor remains to be consumed.
  if (input.nextCursor) return { kind: "loading_next_page" };
  if (reason === "ALL_MATCHES_ACTIONED") return { kind: "exhausted", emptyReason: reason };
  if (reason === "ALL_MATCHES_POLICY_HIDDEN") return { kind: "policy_hidden", emptyReason: reason };
  if (reason === "ALL_MATCHES_BLOCKED") return { kind: "blocked", emptyReason: reason };
  if (reason === "PROFILE_NOT_READY") return { kind: "profile_not_ready", emptyReason: reason };
  if (reason === "NO_MATCHING_INVENTORY" || inventoryState === "inventory_gap") {
    return { kind: "no_inventory", emptyReason: reason };
  }
  return { kind: "legacy_empty", emptyReason: reason };
}

export type SwipeFeedSuggestionId = "preferences" | "location" | "radius" | "filters" | "revisit_later";

export type SwipeFeedSuggestion = { id: SwipeFeedSuggestionId };

/**
 * Purely derives terminal-feed suggestions from the committed query snapshot.
 * It intentionally never reads server inventory or changes filters itself.
 */
export function resolveSwipeFeedSuggestions(input: {
  targetLocationData?: unknown;
  targetLocation?: string | null;
  filters?: Record<string, unknown> | null;
}): SwipeFeedSuggestion[] {
  const filters = input.filters || {};
  const locations = Array.isArray(filters.locations) ? filters.locations : [];
  const locationsData = Array.isArray(filters.locationsData) ? filters.locationsData : [];
  const hasLocation = Boolean(
    input.targetLocationData || filters.locationData || locationsData.length || locations.length
    || (input.targetLocation && input.targetLocation !== "Anywhere"),
  );
  const radius = String(filters.searchRadius || "50km").toLowerCase();
  const radiusIsWorldwide = radius === "worldwide" || Number.parseInt(radius, 10) >= 500;
  const arrays = ["workLocations", "jobTypes", "experience", "onlyCompanies", "hideCompanies", "onlyIndustries", "hideIndustries"];
  const hasBroadenableFilter = Boolean(
    Number(filters.minSalary || 0) > 0
    || (filters.postedDate && filters.postedDate !== "any")
    || arrays.some((key) => {
      const value = filters[key];
      return Array.isArray(value) && value.length > 0;
    })
    || filters.includeUnknownLocation === false
    || filters.includeUnknownSalary === false
    || filters.onlyMyCountry === true,
  );
  const suggestions: SwipeFeedSuggestion[] = [{ id: "preferences" }];
  if (hasLocation) suggestions.push({ id: "location" });
  if (hasLocation && !radiusIsWorldwide) suggestions.push({ id: "radius" });
  if (hasBroadenableFilter) suggestions.push({ id: "filters" });
  if (suggestions.length === 1) suggestions.push({ id: "revisit_later" });
  return suggestions;
}

/**
 * The server cursor is authoritative. Once its final page has been consumed,
 * local swipe-history filtering can leave no renderable cards even though that
 * last response contained jobs. In that narrow case, the only safe terminal
 * interpretation is that the user has already actioned those remaining cards.
 *
 * Do not infer this for a location/policy filter or for an upstream empty
 * response: those states need their own server-provided reason.
 */
export function deriveFinalCursorActionedReason(input: {
  nextCursor?: string | null;
  upstreamEmptyReason?: unknown;
  jobsBeforeActionFilter: number;
  jobsAfterActionFilter: number;
}): "ALL_MATCHES_ACTIONED" | null {
  if (input.nextCursor || input.upstreamEmptyReason) return null;
  if (input.jobsBeforeActionFilter <= 0 || input.jobsAfterActionFilter !== 0) return null;
  return "ALL_MATCHES_ACTIONED";
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
