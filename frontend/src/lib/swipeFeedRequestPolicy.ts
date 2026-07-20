type SwipeFeedRequestContext = {
  replace: boolean;
  currentJobCount: number;
  reason?: string;
};

/**
 * DB-only prefetch is safe only while the UI already has cards to display.
 * An empty stack needs the normal feed request so the backend can discover
 * provider inventory instead of returning a terminal empty state.
 */
export function shouldPrefetchSwipeFeed({
  replace,
  currentJobCount,
  reason = "",
}: SwipeFeedRequestContext): boolean {
  if (currentJobCount <= 0) return false;
  return !replace || reason === "background_refresh_cache";
}
