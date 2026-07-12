import axios from "axios";
import { parseApiPath } from "./apiPath";
import { referralCodeFromUserId } from "./referral";

const DEV_USES_KEY = "hirly.friend_referral.dev_uses";
const DEV_REWARD_KEY = "hirly.friend_referral.dev_reward";

function devUsesCount() {
  try {
    return Number(localStorage.getItem(DEV_USES_KEY) || 0);
  } catch {
    return 0;
  }
}

function incrementDevUses() {
  const next = devUsesCount() + 1;
  try {
    localStorage.setItem(DEV_USES_KEY, String(next));
    if (next >= 3) {
      localStorage.setItem(DEV_REWARD_KEY, "1");
    }
  } catch {
    /* ignore */
  }
  return next;
}

function devRewardGranted() {
  try {
    return localStorage.getItem(DEV_REWARD_KEY) === "1" || devUsesCount() >= 3;
  } catch {
    return devUsesCount() >= 3;
  }
}

function devStatusPayload(userId = "dev_user") {
  const code = referralCodeFromUserId(userId);
  const uses = devUsesCount();
  const rewardGranted = devRewardGranted();
  return {
    enrolled: true,
    code,
    uses_count: uses,
    goal: 3,
    reward_granted: rewardGranted,
    reward_credits: rewardGranted ? 40 : 0,
    pending_access: !rewardGranted && uses < 3,
  };
}

/** Local mock for friend referral endpoints when backend is unavailable. */
export function getFriendReferralDevResponse(config) {
  if (process.env.NODE_ENV !== "development") return undefined;

  const method = (config.method || "get").toLowerCase();
  let requestUrl = config.url || "";
  try {
    requestUrl = axios.getUri(config);
  } catch {
    /* use config.url */
  }
  const { path } = parseApiPath(requestUrl);

  if (method === "post" && path === "/referrals/friends/enroll") {
    return devStatusPayload("dev_onboarding_user");
  }

  if (method === "get" && path === "/referrals/friends/status") {
    return devStatusPayload("dev_onboarding_user");
  }

  if (method === "post" && path === "/referrals/friends/redeem") {
    const uses = incrementDevUses();
    return { ok: true, uses_count: uses, goal: 3, reward_unlocked: uses >= 3 };
  }

  if (method === "post" && path === "/referrals/friends/claim") {
    try {
      localStorage.setItem(DEV_REWARD_KEY, "1");
    } catch {
      /* ignore */
    }
    return { ...devStatusPayload("dev_onboarding_user"), reward_granted: true, reward_credits: 40, pending_access: false };
  }

  return undefined;
}
