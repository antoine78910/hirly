import { trackEvent } from "./analytics";
import { trackDatafastGoal } from "./datafast";

/** DataFast funnel — friend referral (invite 3 friends). */
export const FRIEND_REFERRAL_DATAFAST_FUNNEL = [
  { order: 1, goal: "friend_referral_enrolled", label: "Referral code generated" },
  { order: 2, goal: "friend_referral_shared", label: "Referral code copied or shared" },
  { order: 3, goal: "friend_referral_redeemed", label: "Referral code redeemed (invitee)" },
  { order: 4, goal: "friend_referral_progress", label: "Referrer progress (friend joined / reward ready / claimed)" },
];

function trackFriendReferralGoal(goal, params = {}) {
  trackDatafastGoal(goal, params);
  trackEvent(goal, params);
}

export function trackFriendReferralCodeGenerated(params = {}) {
  trackFriendReferralGoal("friend_referral_enrolled", params);
}

export function trackFriendReferralCodeCopied(params = {}) {
  trackFriendReferralGoal("friend_referral_shared", { action: "copy", ...params });
}

export function trackFriendReferralCodeShared(params = {}) {
  trackFriendReferralGoal("friend_referral_shared", { action: "share", ...params });
}

export function trackFriendReferralCodeRedeemed(params = {}) {
  trackFriendReferralGoal("friend_referral_redeemed", params);
}

export function trackFriendReferralInviteReceived(params = {}) {
  trackFriendReferralGoal("friend_referral_progress", { milestone: "friend_joined", ...params });
}

export function trackFriendReferralRewardUnlocked(params = {}) {
  trackFriendReferralGoal("friend_referral_progress", { milestone: "reward_ready", ...params });
}

export function trackFriendReferralRewardClaimed(params = {}) {
  trackFriendReferralGoal("friend_referral_progress", { milestone: "reward_claimed", ...params });
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
