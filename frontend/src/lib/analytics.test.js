import { api } from "./api";
import { trackEvent } from "./analytics";
import { capturePostHogEvent } from "./posthogClient";

jest.mock("./api", () => ({
  api: {
    post: jest.fn(),
  },
}));

jest.mock("./posthogClient", () => ({
  capturePostHogEvent: jest.fn(),
  sanitizeAnalyticsProperties: jest.requireActual("./posthogClient").sanitizeAnalyticsProperties,
}));

describe("trackEvent PostHog parallel delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    api.post.mockResolvedValue({ data: {} });
  });

  it("sends the same sanitized event to first-party and PostHog sinks", async () => {
    await trackEvent("checkout_started", {
      plan: "pro",
      email: "person@example.com",
      current_url: "https://tryhirly.com/onboarding?token=secret#x",
    });

    expect(capturePostHogEvent).toHaveBeenCalledWith("checkout_started", {
      plan: "pro",
      current_url: "https://tryhirly.com/onboarding",
    });
    expect(api.post).toHaveBeenCalledWith(
      "/analytics/event",
      expect.objectContaining({
        event: "checkout_started",
        properties: {
          plan: "pro",
          current_url: "https://tryhirly.com/onboarding",
        },
      }),
    );
  });

  it("does not let either sink failure block the caller", async () => {
    capturePostHogEvent.mockImplementationOnce(() => {
      throw new Error("posthog unavailable");
    });
    api.post.mockRejectedValueOnce(new Error("first-party unavailable"));
    await expect(trackEvent("safe_event", { step: 1 })).resolves.toBeUndefined();
  });

  it("keeps empty events as no-ops", async () => {
    await trackEvent("", { safe: true });
    expect(api.post).not.toHaveBeenCalled();
    expect(capturePostHogEvent).not.toHaveBeenCalled();
  });
});
