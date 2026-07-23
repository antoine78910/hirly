const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockStartSessionRecording = jest.fn();
const mockStopSessionRecording = jest.fn();

jest.mock("posthog-js", () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
  },
}));

import posthog from "posthog-js";
import {
  __resetPostHogForTests,
  buildPostHogPersonProperties,
  buildPostHogConfig,
  capturePostHogEvent,
  capturePostHogPageview,
  hasIdentifiedPostHogUser,
  identifyPostHogUser,
  initializePostHog,
  isCanonicalAnalyticsUserId,
  resetPostHog,
  sanitizeAnalyticsProperties,
  sanitizePostHogEvent,
} from "./posthogClient";

const mockInit = posthog.init as jest.Mock;
const mockClient = {
  capture: mockCapture,
  identify: mockIdentify,
  reset: mockReset,
  startSessionRecording: mockStartSessionRecording,
  stopSessionRecording: mockStopSessionRecording,
};

describe("posthog client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPostHogForTests();
    delete process.env.REACT_APP_POSTHOG_TOKEN;
    delete process.env.REACT_APP_POSTHOG_HOST;
    delete process.env.REACT_APP_POSTHOG_REPLAY_ENABLED;
    delete process.env.REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED;
    mockInit.mockReturnValue(mockClient);
  });

  it("stays disabled without a complete valid config", () => {
    expect(initializePostHog()).toBeNull();
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "javascript:alert(1)";
    __resetPostHogForTests();
    expect(initializePostHog()).toBeNull();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("initializes one singleton and keeps replay stopped in profile A", () => {
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "https://us.i.posthog.com";
    expect(initializePostHog()).toBe(mockClient);
    expect(initializePostHog()).toBe(mockClient);
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockStopSessionRecording).toHaveBeenCalled();
  });

  it("keeps automatic capture suppressed while enabling remote feature flags", () => {
    const profileA = buildPostHogConfig();
    expect(profileA).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_surveys: true,
      disable_session_recording: true,
      advanced_disable_flags: false,
      advanced_disable_feature_flags: false,
    });

    process.env.REACT_APP_POSTHOG_REPLAY_ENABLED = "true";
    process.env.REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED = "true";
    const profileB = buildPostHogConfig();
    expect(profileB).toMatchObject({
      disable_session_recording: false,
      advanced_disable_flags: false,
      advanced_disable_feature_flags: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        recordCrossOriginIframes: false,
        captureCanvas: { recordCanvas: false },
        recordHeaders: false,
        recordBody: false,
      },
    });
    expect(profileB).not.toHaveProperty("enable_heatmaps");
  });

  it("removes nested sensitive keys, unsafe values, cycles, and URL secrets", () => {
    const cyclic: Record<string, unknown> = { safe: "ok" };
    cyclic.self = cyclic;
    const result = sanitizeAnalyticsProperties({
      safe: "ok",
      eMail: "person@example.com",
      accessToken: "secret",
      nested: { cover_letter: "private", plan: "pro" },
      currentUrl: "https://tryhirly.com/onboarding?email=x#secret",
      callback: () => "unsafe",
      cyclic,
    });
    expect(result).toEqual({
      safe: "ok",
      nested: { plan: "pro" },
      currentUrl: "https://tryhirly.com/onboarding",
      cyclic: { safe: "ok" },
    });
  });

  it("drops snapshots and sanitizes final sdk-enriched URLs", () => {
    expect(sanitizePostHogEvent({ event: "$snapshot", properties: {} } as never)).toBeNull();
    expect(
      sanitizePostHogEvent({
        event: "$pageview",
        properties: {
          $current_url: "https://tryhirly.com/swipe?session_id=secret#token",
          $referrer: "https://example.com/?email=x",
          plan: "pro",
        },
      } as never),
    ).toEqual({
      event: "$pageview",
      properties: {
        $current_url: "https://tryhirly.com/swipe",
        $referrer: "https://example.com/",
        plan: "pro",
      },
    });
  });

  it("allows replay snapshots only in the replay build profile", () => {
    const snapshot = { event: "$snapshot", properties: { $snapshot_data: "opaque" } } as never;
    expect(sanitizePostHogEvent(snapshot)).toBeNull();
    process.env.REACT_APP_POSTHOG_REPLAY_ENABLED = "true";
    expect(sanitizePostHogEvent(snapshot)).toBeNull();
    process.env.REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED = "true";
    expect(sanitizePostHogEvent(snapshot)).toBe(snapshot);
    expect(
      sanitizePostHogEvent({ event: "$feature_flag_called", properties: {} } as never),
    ).toBeNull();
  });

  it("preserves SDK transport properties while rejecting caller secrets", () => {
    const event = sanitizePostHogEvent({
      event: "checkout_started",
      properties: {
        plan: "pro",
        token: "phc_sdk_project",
        $session_id: "sdk-session",
        $window_id: "sdk-window",
        accessToken: "caller-secret",
      },
    } as never);
    expect(event?.properties).toMatchObject({
      plan: "pro",
      token: "phc_sdk_project",
      $session_id: "sdk-session",
      $window_id: "sdk-window",
    });
    expect(event?.properties).not.toHaveProperty("accessToken");
  });

  it("allows approved person labels only on identify events", () => {
    expect(
      buildPostHogPersonProperties({
        email: "  ADA@Example.com ",
        name: "Ada Byron Lovelace",
      }),
    ).toEqual({
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Byron Lovelace",
    });

    const identified = sanitizePostHogEvent({
      event: "$identify",
      properties: {
        $anon_distinct_id: "anonymous-before-signup",
        $set: {
          email: "ada@example.com",
          first_name: "Ada",
          last_name: "Lovelace",
          phone: "+33123456789",
        },
      },
    } as never);
    expect(identified?.properties).toMatchObject({
      $anon_distinct_id: "anonymous-before-signup",
      $set: {
        email: "ada@example.com",
        first_name: "Ada",
        last_name: "Lovelace",
      },
    });
    expect(identified?.properties?.$set).not.toHaveProperty("phone");

    const normalEvent = sanitizePostHogEvent({
      event: "checkout_started",
      properties: { plan: "pro", email: "ada@example.com" },
    } as never);
    expect(normalEvent?.properties).toEqual({ plan: "pro" });
  });

  it("rejects person labels containing control characters", () => {
    expect(buildPostHogPersonProperties({ name: "Ada\u0000Lovelace" })).toEqual({});
  });

  it("links anonymous activity on first identify and resets only for account switches", () => {
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "https://us.i.posthog.com";
    initializePostHog();

    capturePostHogPageview("/onboarding");
    capturePostHogPageview("/onboarding");
    capturePostHogPageview("/swipe");
    expect(mockCapture).toHaveBeenCalledTimes(2);
    expect(mockCapture).toHaveBeenLastCalledWith(
      "$pageview",
      {
        $current_url: "http://localhost/swipe",
      },
      undefined,
    );

    identifyPostHogUser("123e4567-e89b-12d3-a456-426614174000", {
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(hasIdentifiedPostHogUser()).toBe(true);
    identifyPostHogUser("123e4567-e89b-12d3-a456-426614174000", {
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    identifyPostHogUser("123e4567-e89b-12d3-a456-426614174001");
    expect(mockIdentify).toHaveBeenCalledTimes(2);
    expect(mockIdentify).toHaveBeenNthCalledWith(1, "123e4567-e89b-12d3-a456-426614174000", {
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    });
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockIdentify.mock.invocationCallOrder[0]).toBeLessThan(
      mockReset.mock.invocationCallOrder[0],
    );
    expect(mockReset.mock.invocationCallOrder[0]).toBeLessThan(
      mockIdentify.mock.invocationCallOrder[1],
    );
    resetPostHog();
    expect(mockReset).toHaveBeenCalledTimes(2);
    expect(hasIdentifiedPostHogUser()).toBe(false);
  });

  it("resets persisted identity state on anonymous and invalid transitions", () => {
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "https://us.i.posthog.com";
    initializePostHog();

    resetPostHog();
    identifyPostHogUser("not-a-canonical-user");

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockIdentify).not.toHaveBeenCalled();
    expect(hasIdentifiedPostHogUser()).toBe(false);
  });

  it("accepts only canonical lowercase UUID identities", () => {
    expect(isCanonicalAnalyticsUserId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    for (const invalid of [
      "",
      "anonymous",
      "user-a",
      "123E4567-E89B-12D3-A456-426614174000",
      "123e4567-e89b-02d3-a456-426614174000",
    ]) {
      expect(isCanonicalAnalyticsUserId(invalid)).toBe(false);
    }
  });

  it("keeps capture best-effort", () => {
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "https://us.i.posthog.com";
    initializePostHog();
    mockCapture.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => capturePostHogEvent("checkout_started", { plan: "pro" })).not.toThrow();
  });

  it("preserves validated occurrence time in the SDK capture options", () => {
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "https://us.i.posthog.com";
    initializePostHog();

    capturePostHogEvent("checkout_intent_started", { plan: "pro" }, "2026-07-20T18:00:00.000Z");

    expect(mockCapture).toHaveBeenCalledWith(
      "checkout_intent_started",
      { plan: "pro" },
      { timestamp: new Date("2026-07-20T18:00:00.000Z") },
    );
  });
});
