import { trackEvent } from "./analytics";
import { trackDatafastGoal } from "./datafast";
import {
  trackFriendReferralInviteReceived,
  trackFriendReferralRewardUnlocked,
  trackFriendReferralUsesProgress,
} from "./friendReferralAnalytics";

jest.mock("./analytics", () => ({
  trackEvent: jest.fn(),
}));

jest.mock("./datafast", () => ({
  trackDatafastGoal: jest.fn(),
}));

describe("trackFriendReferralUsesProgress", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing when count is unchanged", () => {
    trackFriendReferralUsesProgress(2, 2, { code: "ABC123" });
    expect(trackDatafastGoal).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("tracks friend joined when count increases", () => {
    trackFriendReferralUsesProgress(1, 2, { code: "ABC123" });
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_progress",
      expect.objectContaining({
        milestone: "friend_joined",
        uses_count: "2",
        previous_uses_count: "1",
        code: "ABC123",
      }),
    );
  });

  it("tracks reward ready at 3 friends", () => {
    trackFriendReferralUsesProgress(2, 3, { code: "ABC123" });
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_progress",
      expect.objectContaining({ milestone: "friend_joined" }),
    );
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_progress",
      expect.objectContaining({ milestone: "reward_ready", uses_count: "3" }),
    );
  });
});

describe("friend referral goal helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("tracks progress milestones with a single goal name", () => {
    trackFriendReferralInviteReceived({ uses_count: "1" });
    trackFriendReferralRewardUnlocked({ uses_count: "3" });
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_progress",
      expect.objectContaining({ milestone: "friend_joined" }),
    );
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_progress",
      expect.objectContaining({ milestone: "reward_ready" }),
    );
    expect(trackEvent).toHaveBeenCalledTimes(2);
  });
});
