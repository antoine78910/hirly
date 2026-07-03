import { DEFAULT_SEARCH_RADIUS, mergeFilters } from "./jobFilters";

export const CONTRACT_TYPE_TO_JOB_TYPES = {
  permanent: ["full_time"],
  fixed_term: ["fixed_term"],
  internship: ["internship"],
  apprenticeship: ["apprenticeship"],
  summer_job: ["summer_job"],
  part_time: ["part_time"],
  seasonal: ["seasonal"],
  freelance: ["freelance"],
};

export const JOB_TYPE_ALIASES = {
  full_time: ["full time", "full-time", "permanent", "cdi", "temps plein"],
  part_time: ["part time", "part-time", "temps partiel", "mi-temps"],
  internship: ["intern", "internship", "stage", "stagiaire"],
  fixed_term: ["fixed term", "fixed-term", "cdd", "temporary", "interim", "intérim"],
  apprenticeship: ["apprenticeship", "alternance", "apprentissage", "contrat pro"],
  summer_job: ["summer job", "job d'été", "job d ete", "emploi estival"],
  seasonal: ["seasonal", "saisonnier", "vendanges", "harvest"],
  freelance: ["freelance", "contractor", "independent", "mission"],
};

export function resolveProfileContractType(profile) {
  if (!profile) return "";
  const direct = String(profile.contract_type || "").trim();
  if (direct) return direct;
  const onboarding = profile?.extras?.onboarding;
  return String(onboarding?.contract_type || "").trim();
}

export function contractTypeToJobTypes(contractType) {
  const key = String(contractType || "").trim().toLowerCase();
  if (!key) return [];
  return CONTRACT_TYPE_TO_JOB_TYPES[key] || [];
}

export function buildDefaultFiltersFromProfile(profile) {
  const hasLocation = Boolean(
    profile?.target_location_data?.location_label || profile?.target_location,
  );
  const jobTypes = contractTypeToJobTypes(resolveProfileContractType(profile));
  const filters = mergeFilters({
    jobTypes,
    includeUnknownLocation: !hasLocation,
    searchRadius: DEFAULT_SEARCH_RADIUS,
  });
  if (profile?.target_location_data) {
    filters.locationsData = [profile.target_location_data];
  } else if (profile?.target_location) {
    filters.locations = [profile.target_location];
  }
  return filters;
}

export function mergeProfileFilterDefaults(persisted, profile) {
  const defaults = buildDefaultFiltersFromProfile(profile);
  if (!persisted) return defaults;
  const merged = mergeFilters(persisted);
  if (!(merged.jobTypes || []).length && (defaults.jobTypes || []).length) {
    merged.jobTypes = defaults.jobTypes;
  }
  if (merged.includeUnknownLocation !== false && defaults.includeUnknownLocation === false) {
    merged.includeUnknownLocation = false;
  }
  if (!(merged.locationsData || []).length && !(merged.locations || []).length) {
    if (defaults.locationsData?.length) merged.locationsData = defaults.locationsData;
    else if (defaults.locations?.length) merged.locations = defaults.locations;
  }
  return merged;
}

const normalizeLocationKey = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Drop Paris/finance demo filters that leaked into localStorage for normal users. */
export function reconcileFiltersForUser(persisted, profile) {
  const profileLocation = profile?.target_location_data?.location_label || profile?.target_location || "";
  const profileKey = normalizeLocationKey(profileLocation);
  let next = persisted;

  if (next && profileKey) {
    const persistedLabel =
      next.locationsData?.[0]?.location_label || next.locations?.[0] || "";
    const persistedKey = normalizeLocationKey(persistedLabel);
    const looksLikeFinanceDemoParis =
      /paris/.test(persistedKey) && profileKey && persistedKey !== profileKey;
    if (looksLikeFinanceDemoParis) {
      next = null;
    }
  }

  return mergeProfileFilterDefaults(next, profile);
}
