import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

import PostHogLifecycle from "./PostHogLifecycle";

const mockCapturePostHogPageview = jest.fn();
const mockIdentifyPostHogUser = jest.fn();
const mockResetPostHog = jest.fn();
const mockSyncPostHogReplay = jest.fn();
let currentUser: { user_id: string } | null = null;

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: currentUser }),
}));

jest.mock("@/lib/posthogClient", () => ({
  capturePostHogPageview: mockCapturePostHogPageview,
  identifyPostHogUser: mockIdentifyPostHogUser,
  resetPostHog: mockResetPostHog,
  syncPostHogReplay: mockSyncPostHogReplay,
}));

let navigate: ReturnType<typeof useNavigate>;
function Navigator() {
  navigate = useNavigate();
  return null;
}

function Harness() {
  return (
    <>
      <PostHogLifecycle />
      <Navigator />
    </>
  );
}

describe("PostHogLifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = null;
  });

  it("captures initial and pathname-only navigation once under StrictMode", () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/onboarding?step=phone#x"]}>
          <Harness />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(1);
    expect(mockCapturePostHogPageview).toHaveBeenLastCalledWith("/onboarding");

    act(() => navigate("/onboarding?step=other#secret"));
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(1);

    act(() => navigate("/swipe?session_id=secret"));
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(2);
    expect(mockCapturePostHogPageview).toHaveBeenLastCalledWith("/swipe");
  });

  it("resets before switching identified users", () => {
    currentUser = { user_id: "user-a" };
    const rendered = render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    expect(mockIdentifyPostHogUser).toHaveBeenCalledWith("user-a");

    currentUser = { user_id: "user-b" };
    rendered.rerender(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    expect(mockResetPostHog.mock.invocationCallOrder[0]).toBeLessThan(
      mockIdentifyPostHogUser.mock.invocationCallOrder[1],
    );
    expect(mockIdentifyPostHogUser).toHaveBeenLastCalledWith("user-b");
  });
});
