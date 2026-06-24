export const BILLING_UPDATED = "hirly:billing-updated";

export function notifyBillingUpdated(billing) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BILLING_UPDATED, { detail: billing }));
}
