import { api } from "./api";
import { notifyBillingUpdated } from "./billingEvents";
import {
  consumeCheckoutSessionId,
  peekCheckoutSessionId,
  stashCheckoutSessionId,
} from "./pendingCheckout";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hasGrantedCredits(data) {
  return Boolean(data?.is_premium) && Number(data?.credits_remaining) > 0;
}

/**
 * After Stripe checkout, confirm the session server-side (fast path) then poll
 * billing status until credits appear or retries are exhausted.
 */
export async function syncBillingAfterCheckout({
  sessionId,
  maxAttempts = 12,
  delayMs = 1500,
} = {}) {
  const resolvedSessionId = (sessionId || peekCheckoutSessionId() || "").trim();
  if (resolvedSessionId) {
    stashCheckoutSessionId(resolvedSessionId);
  }

  if (resolvedSessionId) {
    try {
      const { data } = await api.post("/billing/confirm-checkout", { session_id: resolvedSessionId });
      if (data) {
        notifyBillingUpdated(data);
        if (hasGrantedCredits(data)) {
          consumeCheckoutSessionId();
          return data;
        }
        if (data.checkout_pending) {
          /* Stripe may still be finalizing — fall through to polling. */
        }
      }
    } catch (_) {
      // Fall back to polling if confirm-checkout is unavailable or still pending.
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const { data } = await api.post(attempt === 0 ? "/billing/sync" : "/billing/status");
      if (data) {
        notifyBillingUpdated(data);
        if (hasGrantedCredits(data)) {
          consumeCheckoutSessionId();
          return data;
        }
        if (data.is_premium && attempt === maxAttempts - 1) {
          consumeCheckoutSessionId();
          return data;
        }
      }
    } catch (_) {
      // Keep polling; webhook may still be processing.
    }
    if (attempt < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }

  return null;
}

/** Refresh billing from Stripe and repair missing credit grants. */
export async function syncBillingStatus() {
  const { data } = await api.post("/billing/sync");
  if (data) notifyBillingUpdated(data);
  return data;
}

/** Run checkout sync when auth is ready (survives cross-domain redirects). */
export async function resumePendingCheckoutSync(options = {}) {
  const sessionId = peekCheckoutSessionId();
  if (!sessionId) return null;
  return syncBillingAfterCheckout({ sessionId, ...options });
}
