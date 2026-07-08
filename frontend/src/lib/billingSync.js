import { api } from "./api";
import { notifyBillingUpdated } from "./billingEvents";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After Stripe checkout, confirm the session server-side (fast path) then poll
 * billing status until credits appear or retries are exhausted.
 */
export async function syncBillingAfterCheckout({
  sessionId,
  maxAttempts = 8,
  delayMs = 1500,
} = {}) {
  if (sessionId) {
    try {
      const { data } = await api.post("/billing/confirm-checkout", { session_id: sessionId });
      if (data) {
        notifyBillingUpdated(data);
        if (data.is_premium && Number(data.credits_remaining) > 0) {
          return data;
        }
      }
    } catch (_) {
      // Fall back to polling if confirm-checkout is unavailable or still pending.
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const { data } = await api.get("/billing/status");
      if (data) {
        notifyBillingUpdated(data);
        if (data.is_premium && Number(data.credits_remaining) > 0) {
          return data;
        }
        if (data.is_premium && attempt === maxAttempts - 1) {
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
