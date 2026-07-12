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
    if (next % 3 === 0) {
      localStorage.setItem(DEV_REWARD_KEY, String(Math.floor(next / 3)));
    }
  } catch {
    /* ignore */
  }
  return next;
}

function devBatchesGranted() {
  const uses = devUsesCount();
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(DEV_REWARD_KEY) || 0);
  } catch {
    stored = 0;
  }
  return Math.max(stored, Math.floor(uses / 3));
}

function devStatusPayload(userId = "dev_user") {
  const code = referralCodeFromUserId(userId);
  const uses = devUsesCount();
  const batches = devBatchesGranted();
  return {
    enrolled: true,
    code,
    uses_count: uses,
    goal: 3,
    progress_in_cycle: uses % 3,
    reward_batches_granted: batches,
    credits_earned_total: batches * 40,
    pending_access: batches === 0 && uses < 3,
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
    return { ok: true, uses_count: uses, goal: 3, reward_unlocked: uses % 3 === 0 };
  }

  if (method === "post" && path === "/referrals/friends/claim") {
    return devStatusPayload("dev_onboarding_user");
  }

  return undefined;
}
