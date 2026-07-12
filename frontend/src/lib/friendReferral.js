import { api } from "./api";
import { BRAND } from "./brand";
import { INVITE_BASE_URL } from "./creatorInvite";
import { referralCodeFromUserId } from "./referral";
import {
  trackFriendReferralCodeGenerated,
  trackFriendReferralCodeRedeemed,
  trackFriendReferralRewardClaimed,
} from "./friendReferralAnalytics";

const PENDING_FRIEND_REFERRAL_KEY = "hirly.friend_referral.pending";

function friendReferralSiteHost() {
  try {
    const base = INVITE_BASE_URL || "https://tryhirly.com";
    return new URL(base).host.replace(/^www\./, "");
  } catch {
    return "tryhirly.com";
  }
}

export function buildFriendReferralShareUrl(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const base = INVITE_BASE_URL
    || (typeof window !== "undefined" ? window.location.origin : "https://tryhirly.com");
  return `${base.replace(/\/+$/, "")}/onboarding?referral=${encodeURIComponent(normalized)}`;
}

export function buildFriendReferralSharePayload(code, lang = "en") {
  const normalized = String(code || "").trim().toUpperCase();
  const url = buildFriendReferralShareUrl(normalized);
  const site = friendReferralSiteHost();

  if (lang === "fr") {
    return {
      url,
      title: `${BRAND.NAME} — recherche d'emploi tout-en-un`,
      text: `Essaie ${BRAND.NAME} sur ${site} et entre mon code de parrainage ${normalized} à l'inscription.`,
    };
  }

  return {
    url,
    title: `${BRAND.NAME} — swipe jobs, get hired`,
    text: `Try ${BRAND.NAME} at ${site} and enter my referral code ${normalized} when you sign up.`,
  };
}

export function buildFriendReferralShareMessage(code, lang = "en") {
  const payload = buildFriendReferralSharePayload(code, lang);
  return `${payload.text}\n\n${payload.url}`;
}

export function storePendingFriendReferralCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!isFriendReferralCode(normalized)) return false;
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(PENDING_FRIEND_REFERRAL_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function getPendingFriendReferralCode() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(PENDING_FRIEND_REFERRAL_KEY) || "";
  } catch {
    return "";
  }
}

export function clearPendingFriendReferralCode() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_FRIEND_REFERRAL_KEY);
  } catch {
    /* ignore */
  }
}

/** Native share when available; otherwise copies the full invite message. */
export async function shareFriendReferralCode(code, lang = "en") {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    return { ok: false, reason: "no_code" };
  }

  const payload = buildFriendReferralSharePayload(normalized, lang);

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return { ok: true, method: "native", url: payload.url };
    } catch (err) {
      if (err?.name === "AbortError") {
        return { ok: false, reason: "aborted" };
      }
    }
  }

  try {
    await navigator.clipboard.writeText(buildFriendReferralShareMessage(normalized, lang));
    return { ok: true, method: "clipboard", url: payload.url };
  } catch {
    return { ok: false, reason: "clipboard_failed" };
  }
}

export function friendReferralCodeForUser(user) {
  return referralCodeFromUserId(user?.user_id || user?.email || "guest");
}

export async function enrollFriendReferral() {
  const { data } = await api.post("/referrals/friends/enroll");
  if (data?.enrolled || data?.code) {
    trackFriendReferralCodeGenerated({
      code: data.code,
      uses_count: String(data.uses_count ?? 0),
    });
  }
  return data;
}

export async function fetchFriendReferralStatus() {
  const { data } = await api.get("/referrals/friends/status");
  return data;
}

export async function redeemFriendReferralCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const { data } = await api.post("/referrals/friends/redeem", { code: normalized });
  if (data?.ok) {
    trackFriendReferralCodeRedeemed({
      code: normalized,
      referrer_uses_count: String(data.uses_count ?? ""),
      reward_unlocked: data.reward_unlocked ? "true" : "false",
    });
  }
  return data;
}

export async function claimFriendReferralReward(token) {
  const { data } = await api.post("/referrals/friends/claim", {
    token: token || undefined,
  });
  if (data?.reward_batches_granted) {
    trackFriendReferralRewardClaimed({
      uses_count: String(data.uses_count ?? ""),
      reward_credits: String(data.credits_earned_total ?? ""),
    });
  }
  return data;
}

export function isFriendReferralCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code);
}
