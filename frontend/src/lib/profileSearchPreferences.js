import { api } from "./api";
import { EXPERIENCE_LEVELS } from "../components/onboarding/onboardingData";

/** Read search role/location from profile fields with onboarding extras fallback. */
export function resolveProfileSearchPreferences(profile) {
  const onboarding = profile?.extras?.onboarding || {};
  const contact = profile?.contact || {};
  const role = (
    profile?.target_role ||
    profile?.target_roles?.[0] ||
    onboarding.selected_roles?.[0] ||
    ""
  ).trim();
  const locationData =
    profile?.target_location_data ||
    contact?.location_data ||
    onboarding.onboarding_location_data ||
    null;
  const location = (
    profile?.target_location ||
    contact?.location ||
    onboarding.onboarding_location ||
    locationData?.location_label ||
    ""
  ).trim();
  return { role, location, locationData };
}

/** Promote onboarding city/role answers to profile search preferences. */
export async function syncOnboardingSearchPreferences({
  selectedRoles = [],
  onboardingLocation = "",
  onboardingLocationData = null,
  contractType,
  experienceId,
} = {}) {
  const roles = Array.isArray(selectedRoles)
    ? selectedRoles.map((role) => String(role || "").trim()).filter(Boolean)
    : [];
  const primaryRole = roles[0] || "";
  const locationLabel = (onboardingLocationData?.location_label || onboardingLocation || "").trim();

  if (!primaryRole && !locationLabel) return;

  const exp = EXPERIENCE_LEVELS.find((entry) => entry.id === experienceId);
  const payload = { remote_preference: "any" };
  if (primaryRole) {
    payload.target_role = primaryRole;
    payload.target_roles = roles.length ? roles : [primaryRole];
  }
  if (locationLabel) {
    payload.target_location = locationLabel;
    payload.target_location_data = onboardingLocationData || null;
  }
  if (contractType) payload.contract_type = contractType;
  if (exp?.backend) payload.seniority = exp.backend;

  await api.put("/profile/preferences", payload);

  if (locationLabel) {
    try {
      await api.put("/profile/contact", {
        location: locationLabel,
        location_data: onboardingLocationData || undefined,
      });
    } catch (_) {
      /* preferences are enough for feed fallback */
    }
  }
}

export function onboardingSnapshotToSearchSync(snapshot = {}) {
  return {
    selectedRoles: snapshot.selected_roles || [],
    onboardingLocation: snapshot.onboarding_location || "",
    onboardingLocationData: snapshot.onboarding_location_data || null,
    contractType: snapshot.contract_type,
    experienceId: snapshot.experience,
  };
}
