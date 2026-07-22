import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { FEED_V2_ROLLOUT_FLAG_KEY, useFeedV2RolloutObservation } from "./FeedV2RolloutObservation";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockUseFeatureFlagEnabled = jest.fn<boolean, [string, boolean]>();

jest.mock("@posthog/react", () => ({
  useFeatureFlagEnabled: (flag: string, defaultValue: boolean) =>
    mockUseFeatureFlagEnabled(flag, defaultValue),
}));

function Probe({ analyticsUserId }: { analyticsUserId: unknown }) {
  const observed = useFeedV2RolloutObservation(analyticsUserId);
  return <output data-testid="feed-v2-rollout-observation">{String(observed)}</output>;
}

describe("useFeedV2RolloutObservation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFeatureFlagEnabled.mockReturnValue(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("fails closed when the flag is unavailable or disabled", () => {
    act(() => {
      root.render(<Probe analyticsUserId="123e4567-e89b-12d3-a456-426614174000" />);
    });

    expect(mockUseFeatureFlagEnabled).toHaveBeenCalledWith(FEED_V2_ROLLOUT_FLAG_KEY, false);
    expect(container.textContent).toBe("false");
  });

  it("observes an enabled rollout regardless of analytics identity", () => {
    mockUseFeatureFlagEnabled.mockReturnValue(true);

    act(() => {
      root.render(<Probe analyticsUserId="not-a-canonical-user" />);
    });
    expect(container.textContent).toBe("true");
  });
});
