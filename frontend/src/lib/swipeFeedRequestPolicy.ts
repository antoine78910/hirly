type SwipeFeedRequestContext = {
  replace: boolean;
  currentJobCount: number;
  reason?: string;
};

/**
 * Initial searches and background polls stay DB-only so the UI never blocks
 * on the provider's slow path. The backend schedules discovery for an empty
 * prefetch response and these polls pick up the imported inventory.
 */
export function shouldPrefetchSwipeFeed({
  replace,
  currentJobCount,
  reason = "",
}: SwipeFeedRequestContext): boolean {
  if (currentJobCount > 0 && (!replace || reason === "background_refresh_cache")) {
    return true;
  }
  return reason.startsWith("initial_")
    || reason.startsWith("filters_")
    || reason.startsWith("background_poll_");
}
