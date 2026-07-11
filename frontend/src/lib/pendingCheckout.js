export const PENDING_CHECKOUT_SESSION_KEY = "hirly.checkout.pendingSessionId";

export function stashCheckoutSessionId(sessionId) {
  const normalized = (sessionId || "").trim();
  if (!normalized) return;
  try {
    sessionStorage.setItem(PENDING_CHECKOUT_SESSION_KEY, normalized);
  } catch (_) {
    /* ignore storage failures */
  }
}

export function peekCheckoutSessionId() {
  try {
    return sessionStorage.getItem(PENDING_CHECKOUT_SESSION_KEY) || "";
  } catch (_) {
    return "";
  }
}

export function consumeCheckoutSessionId() {
  const sessionId = peekCheckoutSessionId();
  if (!sessionId) return "";
  try {
    sessionStorage.removeItem(PENDING_CHECKOUT_SESSION_KEY);
  } catch (_) {
    /* ignore */
  }
  return sessionId;
}

/** Persist checkout session id from URL before SPA navigation strips query params. */
export function captureCheckoutSessionFromSearch(search = "") {
  const params = new URLSearchParams(search);
  const upgradeStatus = params.get("upgrade") || params.get("checkout");
  const sessionId = (params.get("session_id") || "").trim();
  const isSuccess = upgradeStatus === "success";
  if (isSuccess && sessionId) {
    stashCheckoutSessionId(sessionId);
  }
  return { isSuccess, sessionId };
}
