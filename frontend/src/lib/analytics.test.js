import { api } from "./api";
import { trackEvent } from "./analytics";
import { capturePostHogEvent } from "./posthogClient";

jest.mock("./api", () => ({
  api: {
    post: jest.fn(),
  },
}));

jest.mock("./posthogClient", () => ({
  ...jest.requireActual("./posthogClient"),
  capturePostHogEvent: jest.fn(),
}));

describe("trackEvent PostHog parallel delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    api.post.mockResolvedValue({ data: {} });
  });

  it("sends a canonical registry event to PostHog and preserves the audit event", async () => {
    const before = Date.now();
    await trackEvent("checkout_started", {
      plan: "pro",
      email: "person@example.com",
      current_url: "https://tryhirly.com/onboarding?token=secret#x",
    });

    expect(capturePostHogEvent).toHaveBeenCalledWith(
      "checkout_intent_started",
      expect.objectContaining({
        plan: "pro",
        schema_version: 1,
        event_source: "frontend",
        timestamp_quality: "validated_client_occurrence",
        occurred_at: expect.any(String),
      }),
      expect.any(String),
    );
    const occurredAt = capturePostHogEvent.mock.calls[0][2];
    expect(Date.parse(occurredAt)).toBeGreaterThanOrEqual(before);
    expect(api.post).toHaveBeenCalledWith(
      "/analytics/event",
      expect.objectContaining({
        event: "checkout_started",
        properties: {
          plan: "pro",
          current_url: "https://tryhirly.com/onboarding",
        },
        occurred_at: occurredAt,
      }),
    );
  });

  it("does not double-produce backend authoritative semantic facts", async () => {
    await trackEvent("cv_upload_completed", { source: "onboarding" });
    expect(capturePostHogEvent).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith(
      "/analytics/event",
      expect.objectContaining({
        event: "cv_upload_completed",
        occurred_at: expect.any(String),
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
