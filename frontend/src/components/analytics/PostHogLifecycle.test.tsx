import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import PostHogLifecycle from "./PostHogLifecycle";
import * as posthogBoundary from "../../lib/posthogClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mockCurrentUser: {
  analytics_user_id: string;
  email: string;
  name: string;
} | null = null;
let mockPathname = "/";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mockPathname }),
}), { virtual: true });

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockCurrentUser }),
}));

jest.mock("../../lib/posthogClient", () => ({
  capturePostHogPageview: jest.fn(),
  identifyPostHogUser: jest.fn(),
  resetPostHog: jest.fn(),
  syncPostHogReplay: jest.fn(),
}));

const mockCapturePostHogPageview = posthogBoundary.capturePostHogPageview as jest.Mock;
const mockIdentifyPostHogUser = posthogBoundary.identifyPostHogUser as jest.Mock;
const mockResetPostHog = posthogBoundary.resetPostHog as jest.Mock;
const mockSyncPostHogReplay = posthogBoundary.syncPostHogReplay as jest.Mock;

describe("PostHogLifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = null;
    mockPathname = "/";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("observes pathname-only navigation and replay lifecycle", () => {
    mockPathname = "/onboarding";
    act(() => {
      root.render(<PostHogLifecycle />);
    });
    expect(mockCapturePostHogPageview).toHaveBeenLastCalledWith("/onboarding");
    expect(mockSyncPostHogReplay).toHaveBeenCalledTimes(1);

    act(() => root.render(<PostHogLifecycle />));
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(1);

    mockPathname = "/swipe";
    act(() => root.render(<PostHogLifecycle />));
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(2);
    expect(mockCapturePostHogPageview).toHaveBeenLastCalledWith("/swipe");
  });

  it("forwards stable identities and anonymous resets to the safe client boundary", () => {
    mockCurrentUser = {
      analytics_user_id: "123e4567-e89b-12d3-a456-426614174000",
      email: "user@example.com",
      name: "Ada Lovelace",
    };
    act(() => {
      root.render(<PostHogLifecycle />);
    });
    expect(mockIdentifyPostHogUser).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
      { email: "user@example.com", name: "Ada Lovelace" },
    );
    expect(mockIdentifyPostHogUser.mock.invocationCallOrder[0]).toBeLessThan(
      mockCapturePostHogPageview.mock.invocationCallOrder[0],
    );

    mockCurrentUser = null;
    act(() => {
      root.render(<PostHogLifecycle />);
    });
    expect(mockResetPostHog).toHaveBeenCalled();
    expect(mockResetPostHog.mock.invocationCallOrder[0]).toBeLessThan(
      mockCapturePostHogPageview.mock.invocationCallOrder.at(-1)!,
    );
  });
});
