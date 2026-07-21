export const BILLING_UPDATED = "hirly:billing-updated";

export function mergeBillingUpdate(previous, patch) {
  if (!patch || typeof patch !== "object") return previous ?? null;
  return {
    ...(previous || {}),
    ...patch,
    is_premium: patch.is_premium ?? previous?.is_premium ?? true,
    plan_tier: patch.plan_tier ?? previous?.plan_tier ?? previous?.plan ?? null,
    credits_total: patch.credits_total ?? previous?.credits_total,
    credits_remaining: patch.credits_remaining ?? previous?.credits_remaining,
  };
}

export function notifyBillingUpdated(billing) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BILLING_UPDATED, { detail: billing }));
}

export function notifyBillingPatch(previous, patch) {
  const next = mergeBillingUpdate(previous, patch);
  if (next) notifyBillingUpdated(next);
  return next;
}
