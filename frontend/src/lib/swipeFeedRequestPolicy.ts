type SwipeFeedRequestContext = {
  replace: boolean;
  currentJobCount: number;
  reason?: string;
};

// Long enough to outlive the backend's bounded 45-second discovery attempt,
// while keeping the number of DB-only reconciliation reads small.
export const SWIPE_BACKGROUND_POLL_DELAYS_MS = [3000, 7000, 12000, 18000, 25000] as const;

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
