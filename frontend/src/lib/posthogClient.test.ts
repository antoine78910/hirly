const mockInit = jest.fn();
const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockStartSessionRecording = jest.fn();
const mockStopSessionRecording = jest.fn();

jest.mock("posthog-js", () => ({
  __esModule: true,
  default: {
    init: mockInit,
  },
}));

import {
  __resetPostHogForTests,
  buildPostHogConfig,
  capturePostHogEvent,
  initializePostHog,
  sanitizeAnalyticsProperties,
  sanitizePostHogEvent,
} from "./posthogClient";

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

  it("uses strict automatic-capture suppression in both profiles", () => {
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
      advanced_disable_flags: true,
      advanced_disable_feature_flags: false,
    });

    process.env.REACT_APP_POSTHOG_REPLAY_ENABLED = "true";
    const profileB = buildPostHogConfig();
    expect(profileB).toMatchObject({
      disable_session_recording: false,
      advanced_disable_flags: false,
      advanced_disable_feature_flags: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        recordCrossOriginIframes: false,
        recordCanvas: false,
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

  it("keeps capture best-effort", () => {
    process.env.REACT_APP_POSTHOG_TOKEN = "phc_test";
    process.env.REACT_APP_POSTHOG_HOST = "https://us.i.posthog.com";
    initializePostHog();
    mockCapture.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => capturePostHogEvent("checkout_started", { plan: "pro" })).not.toThrow();
  });
});
