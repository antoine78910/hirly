import { shouldPrefetchSwipeFeed } from "./swipeFeedRequestPolicy";

describe("shouldPrefetchSwipeFeed", () => {
  it.each([
    "initial_persisted_filters",
    "initial_profile_defaults",
    "initial_empty_after_swipe_filter",
    "filters_applied",
  ])("does not use DB-only prefetch for an empty stack (%s)", (reason) => {
    expect(shouldPrefetchSwipeFeed({ replace: true, currentJobCount: 0, reason })).toBe(false);
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
});
