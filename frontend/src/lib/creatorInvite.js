import { queueDemoWelcome } from "./demoWelcome";
import { queueTrainingWelcome } from "./trainingWelcome";
import { resolvePostAuthDestination } from "./appDomains";

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

export function buildInviteUrl(code) {
  const normalized = String(code || "").trim();
  const base = INVITE_BASE_URL
    || (typeof window !== "undefined" ? window.location.origin : "https://tryhirly.com");
  return `${base}/invite/${normalized}`;
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

export function inviteDestination(redeemData, inviteMeta) {
  const type = redeemData?.invite_type || inviteMeta?.invite_type;
  if (type === "demo") return "/swipe";
  if (type === "training" || redeemData?.training_access) return "/training";
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
export function goToInviteDestination(redeemData, inviteMeta) {
  const dest = inviteDestination(redeemData, inviteMeta);
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
