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

  it("tracks invite received when count increases", () => {
    trackFriendReferralUsesProgress(1, 2, { code: "ABC123" });
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_invite_received",
      expect.objectContaining({ uses_count: "2", previous_uses_count: "1", code: "ABC123" }),
    );
  });

  it("tracks reward unlocked at 3 friends", () => {
    trackFriendReferralUsesProgress(2, 3, { code: "ABC123" });
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_invite_received",
      expect.any(Object),
    );
    expect(trackDatafastGoal).toHaveBeenCalledWith(
      "friend_referral_reward_unlocked",
      expect.objectContaining({ uses_count: "3" }),
    );
  });
});

describe("friend referral goal helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("tracks invite and reward goals separately", () => {
    trackFriendReferralInviteReceived({ uses_count: "1" });
    trackFriendReferralRewardUnlocked({ uses_count: "3" });
    expect(trackEvent).toHaveBeenCalledTimes(2);
  });
});
