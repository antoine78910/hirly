import { resolvePostAuthDestination } from "./appDomains";
import { queueDemoWelcome } from "./demoWelcome";
import { normalizeInviteLocale } from "./inviteLocalization";
import { hasTrainingContent, trainingHubPath } from "./trainingRoutes";
import { queueTrainingWelcome } from "./trainingWelcome";

const PENDING_INVITE_KEY = "hirly.creator_invite.pending";

const normalizeInviteBaseUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
};

/** Public site used in creator invite links (production: tryhirly.com). */
export const INVITE_BASE_URL = normalizeInviteBaseUrl(
  process.env.REACT_APP_INVITE_BASE_URL || "https://tryhirly.com",
);

export function inviteLandingPath(code, locale) {
  const normalized = String(code || "").trim();
  const params = new URLSearchParams({ lang: normalizeInviteLocale(locale) });
  return `/invite/${encodeURIComponent(normalized)}?${params.toString()}`;
}

export function buildInviteUrl(code, locale) {
  const base =
    INVITE_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://tryhirly.com");
  return `${base}${inviteLandingPath(code, locale)}`;
}

export function storePendingInviteCode(code) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  if (typeof window === "undefined") return false;
  // localStorage persists across tabs — required for email-verification links
  // which Supabase opens in a fresh tab (sessionStorage would be empty).
  localStorage.setItem(PENDING_INVITE_KEY, normalized);
  return true;
}

export function getPendingInviteCode() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(PENDING_INVITE_KEY) || "";
}

export function clearPendingInviteCode() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_INVITE_KEY);
}

/** True when auth should auto-redeem a stored creator/demo invite code. */
export function shouldAutoRedeemPendingInvite(...paths) {
  return paths.some((path) => String(path || "").includes("/invite/"));
}

export function inviteLocaleFromPath(path) {
  try {
    const url = new URL(String(path || ""), "https://tryhirly.com");
    return normalizeInviteLocale(url.searchParams.get("lang"));
  } catch {
    return "fr";
  }
}

export function inviteDestination(redeemData, inviteMeta, locale) {
  const type = redeemData?.invite_type || inviteMeta?.invite_type;
  if (type === "demo") return "/swipe";
  if (type === "training" || redeemData?.training_access) {
    const trainingLocale = normalizeInviteLocale(locale);
    return trainingHubPath(hasTrainingContent(trainingLocale) ? trainingLocale : "fr");
  }
  return "/swipe";
}

export function applyRedeemToAuth(redeemData, user, handlers) {
  if (!redeemData || !user) return user;
  const next = { ...user };
  if (redeemData.demo_account) {
    next.demo_account = true;
    handlers.setDemoAccountFromUser?.(next);
    handlers.setHasProfile?.(true);
    handlers.setHasPreferences?.(true);
    queueDemoWelcome();
  }
  if (redeemData.training_access) {
    next.training_access = true;
    handlers.setHasTrainingAccess?.(true);
    queueTrainingWelcome();
  }
  handlers.setUser?.(next);
  return next;
}

/** Navigate after invite activation — handles marketing ↔ app subdomain split. */
export function goToInviteDestination(redeemData, inviteMeta, locale) {
  const dest = inviteDestination(redeemData, inviteMeta, locale);
  const resolved = resolvePostAuthDestination(dest);
  if (resolved.type === "external") {
    window.location.replace(resolved.url);
    return;
  }
  window.location.assign(resolved.path);
}

export async function redeemCreatorInvite(api, code, options = {}) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("Enter a valid 6-digit invitation code");
  }
  const { data } = await api.post("/invites/redeem", { code: normalized, ...options });
  clearPendingInviteCode();
  return data;
}

export async function tryRedeemPendingInvite(api) {
  const code = getPendingInviteCode();
  if (!code) return null;
  try {
    return await redeemCreatorInvite(api, code);
  } catch (err) {
    if (err?.response?.status === 409) {
      clearPendingInviteCode();
    }
    throw err;
  }
}
