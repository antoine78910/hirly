import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceRoot = process.cwd().endsWith("/frontend") ? resolve("src") : resolve("frontend/src");
const swipeSource = readFileSync(resolve(sourceRoot, "pages/Swipe.jsx"), "utf8");
const desktopSource = readFileSync(
  resolve(sourceRoot, "components/swipe/DesktopSwipeFeed.jsx"),
  "utf8",
);
const targetSearchSheetSource = readFileSync(
  resolve(sourceRoot, "components/TargetSearchSheet.jsx"),
  "utf8",
);

describe("Swipe Feed v2 adoption boundary", () => {
  it("gates initial navigation and fences stale responses", () => {
    expect(swipeSource).toContain("initialFeedRequestGateRef.current.claim(navigationIdentity)");
    expect(swipeSource).toContain("feedRequestFenceRef.current.next()");
    expect(swipeSource).toContain("requestFence.isCurrent()");
    expect(
      swipeSource.match(/loadFeed\(true, mergedFilters, \"initial_navigation\"\)/g),
    ).toHaveLength(2);
  });

  it("contains no polling, background refresh, or provider-refresh query behavior", () => {
    for (const forbidden of [
      "background_poll",
      "background_refresh_scheduled",
      "background_refresh_cache",
      "SWIPE_BACKGROUND_POLL_DELAYS_MS",
      'params.set("prefetch"',
      "provider_refresh",
    ]) {
      expect(swipeSource).not.toContain(forbidden);
    }
  });

  it("does not require a manual feed refresh on mobile or desktop", () => {
    expect(swipeSource).not.toContain("refresh-feed-btn");
    expect(swipeSource).not.toContain("desktop_refresh");
    expect(desktopSource).not.toContain("onRefresh");
    expect(desktopSource).not.toContain('t("common.refresh")');
  });

  it("renders loading and typed projection state through the shared policy", () => {
    expect(swipeSource).toContain("resolveSwipeFeedViewState({");
    expect(swipeSource).toContain('"loading_initial"');
    expect(swipeSource).toContain('"loading_next_page"');
    expect(swipeSource).toContain('feedView.kind === "projection_lag"');
    expect(desktopSource).toContain("resolveSwipeFeedViewState({");
    expect(desktopSource).toContain("nextCursor,");
    expect(swipeSource).toContain("jobsRef.current.length === 0");
    expect(swipeSource).toContain('"profile_not_ready"');
    expect(desktopSource).toContain('"profile_not_ready"');
  });

  it("coalesces cursor prefetch and commits the visible stack before terminal rendering", () => {
    expect(swipeSource).toContain("if (!replace && fetchingRef.current) return;");
    expect(swipeSource).toContain("if (replace && feedAbortRef.current)");
    expect(swipeSource).toContain("inFlightCursorRef.current = requestedCursor;");
    expect(swipeSource).toContain("jobsRef.current = filtered;");
    expect(swipeSource).toContain('"low_stack_prefetch"');
    expect(swipeSource).toContain("shouldPrefetchSwipeFeedPage({");
  });

  it("does not send cache/query identity to terminal-state analytics", () => {
    expect(swipeSource).toContain('trackEvent("swipe_feed_terminal_state_viewed"');
    expect(swipeSource).not.toContain("query_identity:");
    expect(swipeSource).toContain("deriveFinalCursorActionedReason");
  });

  it("lets Swipe edit all matching preferences, not only a single role", () => {
    expect(targetSearchSheetSource).toContain("initialRoles = []");
    expect(targetSearchSheetSource).toContain("initialSectorIds = []");
    expect(targetSearchSheetSource).toContain("initialIndustryIds = []");
    expect(targetSearchSheetSource).toContain("MATCHING_SECTORS");
    expect(targetSearchSheetSource).toContain("MATCHING_INDUSTRIES");
    expect(swipeSource).toContain("initialRoles={profile?.target_roles || [target.role]}");
    expect(desktopSource).toContain("desktop-target-preferences");
  });

  it("uses the rollout flag only as a frontend observation", () => {
    expect(swipeSource).toContain("useFeedV2RolloutObservation(user?.analytics_user_id)");
    expect(swipeSource).toContain('data-feed-v2-rollout={feedV2RolloutObserved ? "on" : "off"}');
    expect(swipeSource).toContain("let requestUrl = `/jobs/feed?${params.toString()}`");
  });
});
