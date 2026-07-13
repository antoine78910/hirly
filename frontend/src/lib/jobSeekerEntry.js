import { api } from "./api";
import { goToApp, goToMarketing, domainSplitEnabled, isMarketingHost } from "./appDomains";
import { resolveOnboardingResumeStep } from "./onboardingResume";

/**
 * True when the user may enter /swipe (paid, demo, returning subscriber, or comp access).
 * CV + target_role alone is not enough — users stopped at the paywall must stay in onboarding.
 */
export function canAccessJobSeekerApp({ user, billing, profile } = {}) {
  if (!user) return false;
  if (user.demo_account) return true;

  const b = billing || {};
  if (b.is_premium) return true;
  if (Number(b.credits_remaining ?? 0) > 0) return true;
  if (b.stripe_customer_id_exists) return true;

  const status = String(b.subscription_status || "none").toLowerCase();
  if (status && status !== "none") return true;

  const plan = String(b.plan || "").trim().toLowerCase();
  if (plan && plan !== "none") return true;

  return false;
}

export async function fetchJobSeekerEntryState() {
  const [profileRes, billingRes] = await Promise.all([
    api.get("/profile"),
    api.get("/billing/status"),
  ]);
  return {
    profile: profileRes.data || null,
    billing: billingRes.data || null,
  };
}

/**
 * Decide where an authenticated job seeker should land.
 * Returns { host: "marketing" | "app", path, search }.
 */
export async function resolveJobSeekerEntryDestination(user) {
  if (!user) {
    return { host: "marketing", path: "/onboarding", search: "" };
  }

  if (user.demo_account) {
    return { host: "app", path: "/swipe", search: "" };
  }

  let profile = null;
  let billing = null;
  try {
    ({ profile, billing } = await fetchJobSeekerEntryState());
  } catch {
    return { host: "marketing", path: "/onboarding", search: "?step=jobSearch" };
  }

  if (canAccessJobSeekerApp({ user, billing, profile })) {
    return { host: "app", path: "/swipe", search: "" };
  }

  const step = resolveOnboardingResumeStep({
    onboarding: profile?.extras?.onboarding,
    profile,
    user,
  });

  const params = new URLSearchParams();
  if (step) params.set("step", step);

  const contractType = profile?.extras?.onboarding?.contract_type || profile?.contract_type;
  if (contractType) params.set("contract", contractType);

  const search = params.toString() ? `?${params.toString()}` : "";
  return { host: "marketing", path: "/onboarding", search };
}

export function openJobSeekerDestination(dest, navigate) {
  const target = `${dest.path}${dest.search || ""}`;

  if (dest.host === "app") {
    goToApp(target);
    return;
  }

  if (domainSplitEnabled() && !isMarketingHost()) {
    goToMarketing(target);
    return;
  }

  navigate(target);
}
