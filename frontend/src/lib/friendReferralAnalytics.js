import { trackEvent } from "./analytics";
import { trackDatafastGoal } from "./datafast";

/** DataFast funnel — friend referral (invite 3 friends). */
export const FRIEND_REFERRAL_DATAFAST_FUNNEL = [
  { order: 1, goal: "friend_referral_code_generated", label: "Referral code generated" },
  { order: 2, goal: "friend_referral_code_copied", label: "Referral code copied" },
  { order: 3, goal: "friend_referral_code_shared", label: "Referral code shared" },
  { order: 4, goal: "friend_referral_code_redeemed", label: "Referral code redeemed (invitee)" },
  { order: 5, goal: "friend_referral_invite_received", label: "Friend joined via code (referrer)" },
  { order: 6, goal: "friend_referral_reward_unlocked", label: "3 friends — free access unlocked" },
  { order: 7, goal: "friend_referral_reward_claimed", label: "Free subscription claimed" },
];

function trackFriendReferralGoal(goal, params = {}) {
  trackDatafastGoal(goal, params);
  trackEvent(goal, params);
}

export function trackFriendReferralCodeGenerated(params = {}) {
  trackFriendReferralGoal("friend_referral_code_generated", params);
}

export function trackFriendReferralCodeCopied(params = {}) {
  trackFriendReferralGoal("friend_referral_code_copied", params);
}

export function trackFriendReferralCodeShared(params = {}) {
  trackFriendReferralGoal("friend_referral_code_shared", params);
}

export function trackFriendReferralCodeRedeemed(params = {}) {
  trackFriendReferralGoal("friend_referral_code_redeemed", params);
}

export function trackFriendReferralInviteReceived(params = {}) {
  trackFriendReferralGoal("friend_referral_invite_received", params);
}

export function trackFriendReferralRewardUnlocked(params = {}) {
  trackFriendReferralGoal("friend_referral_reward_unlocked", params);
}

export function trackFriendReferralRewardClaimed(params = {}) {
  trackFriendReferralGoal("friend_referral_reward_claimed", params);
}

/** Fire referrer-side goals when uses_count increases or reward becomes available. */
export function trackFriendReferralUsesProgress(previousCount, nextCount, params = {}) {
  const prev = Number(previousCount) || 0;
  const next = Number(nextCount) || 0;
  if (next <= prev) return;

  trackFriendReferralInviteReceived({
    uses_count: String(next),
    previous_uses_count: String(prev),
    ...params,
  });

  if (next >= 3) {
    trackFriendReferralRewardUnlocked({
      uses_count: String(next),
      ...params,
    });
  }
}
