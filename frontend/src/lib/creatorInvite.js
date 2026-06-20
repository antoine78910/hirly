const PENDING_INVITE_KEY = "hirly.creator_invite.pending";

export function storePendingInviteCode(code) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  if (typeof window === "undefined") return false;
  sessionStorage.setItem(PENDING_INVITE_KEY, normalized);
  return true;
}

export function getPendingInviteCode() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(PENDING_INVITE_KEY) || "";
}

export function clearPendingInviteCode() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_INVITE_KEY);
}

export function buildInviteUrl(code) {
  const normalized = String(code || "").trim();
  if (typeof window === "undefined") return `/invite/${normalized}`;
  return `${window.location.origin}/invite/${normalized}`;
}

export async function redeemCreatorInvite(api, code) {
  const normalized = String(code || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("Enter a valid 6-digit invitation code");
  }
  const { data } = await api.post("/invites/redeem", { code: normalized });
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
