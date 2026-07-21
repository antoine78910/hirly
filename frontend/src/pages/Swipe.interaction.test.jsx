import { canStartSwipe } from "../lib/swipeInteractionPolicy";

describe("swipe interaction availability", () => {
  it("allows liking a visible job while the next feed page is loading", () => {
    expect(canStartSwipe({
      hasJob: { job_id: "job-1" },
      appLoading: false,
      pendingCardSwipe: null,
    })).toBe(true);
  });

  it("blocks duplicate swipes and an in-progress application", () => {
    expect(canStartSwipe({ hasJob: { job_id: "job-1" }, appLoading: true, pendingCardSwipe: null })).toBe(false);
    expect(canStartSwipe({ hasJob: { job_id: "job-1" }, appLoading: false, pendingCardSwipe: "apply" })).toBe(false);
  });
});
