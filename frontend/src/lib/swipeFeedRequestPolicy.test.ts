import {
  createInitialSwipeFeedRequestGate,
  createSwipeFeedRequestFence,
  resolveSwipeFeedViewState,
  sanitizeSwipeFeedParams,
} from "./swipeFeedRequestPolicy";

describe("Swipe Feed v2 request policy", () => {
  it("claims first navigation exactly once for the same request identity", () => {
    const gate = createInitialSwipeFeedRequestGate();
    expect(gate.claim("candidate-1:filters-a")).toBe(true);
    expect(gate.claim("candidate-1:filters-a")).toBe(false);
    expect(gate.claim("candidate-1:filters-b")).toBe(true);
  });

  it("fences stale responses when request identity or filters change", () => {
    const fence = createSwipeFeedRequestFence();
    const first = fence.next();
    expect(first.isCurrent()).toBe(true);
    const second = fence.next();
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("never sends polling or provider-refresh query controls", () => {
    const params = new URLSearchParams({
      search_role: "engineer",
      prefetch: "true",
      refresh: "true",
      provider_refresh: "true",
      background_refresh: "true",
    });
    expect(sanitizeSwipeFeedParams(params).toString()).toBe(
      "search_role=engineer",
    );
    expect(params.get("prefetch")).toBe("true");
    expect(params.get("refresh")).toBe("true");
    expect(params.get("provider_refresh")).toBe("true");
    expect(params.get("background_refresh")).toBe("true");
  });

  it.each([
    [{ loading: true, jobCount: 0 }, "loading"],
    [{ loading: false, jobCount: 1 }, "ready"],
    [
      {
        loading: false,
        jobCount: 0,
        feedMeta: { inventoryState: "matching_pending" },
      },
      "projection_lag",
    ],
    [
      {
        loading: false,
        jobCount: 0,
        feedMeta: { empty_reason: { code: "ALL_MATCHES_ACTIONED" } },
      },
      "empty",
    ],
    [
      {
        loading: false,
        jobCount: 0,
        feedMeta: { emptyReason: "SERVICE_DEGRADED" },
      },
      "error",
    ],
  ] as const)("resolves typed Feed v2 view state %#", (input, expected) => {
    expect(resolveSwipeFeedViewState(input)).toMatchObject({ kind: expected });
  });

  it("keeps loading ahead of empty state on first navigation", () => {
    expect(
      resolveSwipeFeedViewState({
        loading: true,
        jobCount: 0,
        feedMeta: { emptyReason: "NO_MATCHING_INVENTORY" },
      }),
    ).toEqual({ kind: "loading" });
  });

  it("treats unsupported empty-reason values as an untyped empty state", () => {
    expect(
      resolveSwipeFeedViewState({
        loading: false,
        jobCount: 0,
        feedMeta: { empty_reason: { code: "UNKNOWN_UPSTREAM_STATE" as never } },
      }),
    ).toEqual({ kind: "empty", emptyReason: null });
  });

  it("reads typed degraded state from snake_case Feed V2 metadata", () => {
    expect(
      resolveSwipeFeedViewState({
        loading: false,
        jobCount: 0,
        feedMeta: { inventory_state: "degraded" },
      }),
    ).toEqual({ kind: "error", emptyReason: null });
  });
});
