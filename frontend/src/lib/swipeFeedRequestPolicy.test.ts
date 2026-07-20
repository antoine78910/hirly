import {
  shouldPrefetchSwipeFeed,
  SWIPE_BACKGROUND_POLL_DELAYS_MS,
} from "./swipeFeedRequestPolicy";

describe("shouldPrefetchSwipeFeed", () => {
  it.each([
    "initial_persisted_filters",
    "initial_profile_defaults",
    "initial_empty_after_swipe_filter",
    "filters_applied",
    "background_poll_1",
  ])("keeps slow provider discovery out of the foreground request (%s)", (reason) => {
    expect(shouldPrefetchSwipeFeed({ replace: true, currentJobCount: 0, reason })).toBe(true);
  });

  it("uses prefetch when appending to an existing stack", () => {
    expect(shouldPrefetchSwipeFeed({
      replace: false,
      currentJobCount: 4,
      reason: "threshold_prefetch",
    })).toBe(true);
  });

  it("uses prefetch for a silent refresh while cached cards remain visible", () => {
    expect(shouldPrefetchSwipeFeed({
      replace: true,
      currentJobCount: 4,
      reason: "background_refresh_cache",
    })).toBe(true);
  });

  it("uses the normal non-blocking feed path for an explicit empty-state refresh", () => {
    expect(shouldPrefetchSwipeFeed({
      replace: true,
      currentJobCount: 0,
      reason: "empty_refresh",
    })).toBe(false);
  });

  it("polls beyond the backend discovery budget", () => {
    const totalDelay = SWIPE_BACKGROUND_POLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(SWIPE_BACKGROUND_POLL_DELAYS_MS).toHaveLength(5);
    expect(totalDelay).toBeGreaterThan(45000);
  });
});
