import { api } from "./api";
import { goToApp, goToMarketing, domainSplitEnabled, isMarketingHost } from "./appDomains";
import { resolveOnboardingResumeStep } from "./onboardingResume";

/**
 * True when onboarding is far enough that the user may browse the app (feed)
 * even with zero credits — applying still requires credits or premium.
 */
export function hasJobSeekerOnboardingComplete(profile) {
  if (!profile) return false;
  const hasCv = Boolean(profile.cv_text || profile.cv_filename);
  if (!hasCv) return false;
  if (profile.target_role?.trim() || profile.target_roles?.length) return true;
  const onboarding = profile.extras?.onboarding || {};
  return Array.isArray(onboarding.selected_roles) && onboarding.selected_roles.length > 0;
}

/**
 * True when the user may enter /swipe (paid, demo, credits, or onboarding complete).
 */
export function canAccessJobSeekerApp({ user, billing, profile } = {}) {
  if (!user) return false;
  if (user.demo_account) return true;

  const b = billing || {};
  if (b.is_premium) return true;
  if (Number(b.credits_remaining ?? 0) > 0) return true;
  if (hasJobSeekerOnboardingComplete(profile)) return true;

  return false;
}

export async function fetchJobSeekerProfile() {
  const { data } = await api.get("/profile");
  return data || null;
}

export async function fetchJobSeekerEntryState({ includeBilling = true } = {}) {
  const profilePromise = api.get("/profile");
  const billingPromise = includeBilling
    ? api.get("/billing/status")
    : Promise.resolve({ data: null });
  const [profileRes, billingRes] = await Promise.all([profilePromise, billingPromise]);
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
