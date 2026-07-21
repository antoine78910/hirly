import { describe, expect, test } from "bun:test";
import type { FeedAuthAssertion, FeedReadResponse } from "@hirly/feed-v2";
import { FeedCursorError } from "@hirly/feed-v2";
import { createFeedV2Handler } from "../src";

const assertion: FeedAuthAssertion = {
  subject: "user-1",
  candidateId: "candidate-1",
  scopes: ["feed:read"],
  issuedAt: "2026-07-21T10:00:00Z",
  expiresAt: "2026-07-21T13:00:00Z",
};

const response: FeedReadResponse = {
  contractVersion: "hirly.feed.v2",
  jobs: [],
  nextCursor: null,
  inventoryState: "inventory_gap",
  emptyReason: "NO_MATCHING_INVENTORY",
  matchContext: {
    snapshotVersion: "inventory-1",
    profileVersion: "profile-1",
    actionWatermark: "actions-1",
    queryFingerprint: "candidate-profile",
  },
  summary: {
    evaluated: 0,
    eligible: 0,
    hiddenActioned: 0,
    hiddenPolicy: 0,
    hiddenBlocked: 0,
    visibleByRoute: { auto: 0, assisted: 0, manual: 0, blocked: 0 },
  },
};

describe("private Feed v2 HTTP foundation", () => {
  test("keeps routing disabled by default without invoking auth or reads", async () => {
    let authCalls = 0;
    let reads = 0;
    const handler = createFeedV2Handler({
      config: { routingEnabled: false },
      auth: {
        async verify() {
          authCalls += 1;
          return assertion;
        },
      },
      service: {
        async read() {
          reads += 1;
          return response;
        },
      },
    });

    const result = await handler(
      new Request("http://feed.test/internal/feed/v2?limit=12"),
    );
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "feed_v2_disabled" });
    expect([authCalls, reads]).toEqual([0, 0]);
  });

  test("serves authenticated GETs and forwards only cursor and bounded limit", async () => {
    const observed: unknown[] = [];
    const handler = createFeedV2Handler({
      config: { routingEnabled: true },
      auth: { verify: async () => assertion },
      service: {
        async read(request) {
          observed.push(request);
          return response;
        },
      },
    });

    const result = await handler(
      new Request("http://feed.test/internal/feed/v2?limit=24&cursor=opaque"),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual(response);
    expect(observed).toEqual([
      { assertion, cursor: "opaque", limit: 24 },
    ]);
  });

  test("exposes typed stale-cursor and validation failures", async () => {
    const staleHandler = createFeedV2Handler({
      config: { routingEnabled: true },
      auth: { verify: async () => assertion },
      service: {
        async read() {
          throw new FeedCursorError("stale_cursor");
        },
      },
    });
    const stale = await staleHandler(
      new Request("http://feed.test/internal/feed/v2?cursor=old"),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "FEED_CURSOR_STALE" });

    const invalid = await staleHandler(
      new Request("http://feed.test/internal/feed/v2?limit=101"),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_limit" });
  });

  test("rejects every mutation method before auth or service execution", async () => {
    let calls = 0;
    const handler = createFeedV2Handler({
      config: { routingEnabled: true },
      auth: {
        async verify() {
          calls += 1;
          return assertion;
        },
      },
      service: {
        async read() {
          calls += 1;
          return response;
        },
      },
    });

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = await handler(
        new Request("http://feed.test/internal/feed/v2", { method }),
      );
      expect(result.status).toBe(404);
    }
    expect(calls).toBe(0);
  });
});
