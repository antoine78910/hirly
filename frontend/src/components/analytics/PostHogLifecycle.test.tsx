import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("observes pathname-only navigation and replay lifecycle", () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/onboarding?step=phone#x"]}>
          <Harness />
        </MemoryRouter>,
      );
    });
    expect(mockCapturePostHogPageview).toHaveBeenLastCalledWith("/onboarding");
    expect(mockSyncPostHogReplay).toHaveBeenCalledTimes(1);

    act(() => navigate("/onboarding?step=other#secret"));
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(1);

    act(() => navigate("/swipe?session_id=secret"));
    expect(mockCapturePostHogPageview).toHaveBeenCalledTimes(2);
    expect(mockCapturePostHogPageview).toHaveBeenLastCalledWith("/swipe");
  });

  it("forwards stable identities and anonymous resets to the safe client boundary", () => {
    currentUser = { user_id: "user-a" };
    act(() => {
      root.render(
        <MemoryRouter>
          <Harness />
        </MemoryRouter>,
      );
    });
    expect(mockIdentifyPostHogUser).toHaveBeenCalledWith("user-a");

    currentUser = null;
    act(() => {
      root.render(
        <MemoryRouter>
          <Harness />
        </MemoryRouter>,
      );
    });
    expect(mockResetPostHog).toHaveBeenCalled();
  });
});
