import { toast } from "sonner";
import { api } from "./api";
import { isDemoAccountEnabled } from "./demoAccount";
import { TUTORIAL_BYPASS_AUTH } from "./dev";

import { enrichLocationData, isResolvedLocation } from "./locationSearch";

const COUNTRY_CODE_BY_NAME = {
  france: "fr",
  "united kingdom": "gb",
  uk: "gb",
  england: "gb",
  "united states": "us",
  usa: "us",
  morocco: "ma",
  maroc: "ma",
  germany: "de",
  spain: "es",
  espana: "es",
  italy: "it",
  canada: "ca",
  belgium: "be",
  switzerland: "ch",
  netherlands: "nl",
};

export function normalizeLocationData(location, locationData) {
  if (locationData?.location_label) {
    return enrichLocationData(locationData);
  }

  const trimmed = (location || "").trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const country = parts.length > 1 ? parts[parts.length - 1] : "";

  return enrichLocationData({
    location_label: trimmed,
    place_id: "",
    country,
    country_code: COUNTRY_CODE_BY_NAME[country.toLowerCase()] || "",
    lat: null,
    lng: null,
    source: "local",
  });
}

export async function saveTargetPreferences({
  role,
  roles,
  sectorIds,
  industryIds,
  location,
  locationData,
}) {
  const selectedRoles = [
    ...new Set(
      [...(Array.isArray(roles) ? roles : []), role]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ].slice(0, 3);
  const primaryRole = selectedRoles[0] || "";
  if (!primaryRole) {
    toast.error("Please enter a job title");
    return null;
  }

  const trimmedLocation = (location || "").trim();
  const normalizedLocationData = normalizeLocationData(trimmedLocation, locationData);
  if (trimmedLocation && !isResolvedLocation(normalizedLocationData, trimmedLocation)) {
    toast.error("Select a location from the suggestions");
    return null;
  }
  const locationLabel = normalizedLocationData?.location_label || trimmedLocation;

  const payload = {
    target_role: primaryRole,
    target_roles: selectedRoles,
    target_location: locationLabel,
    target_location_data: normalizedLocationData,
  };
  if (Array.isArray(sectorIds)) payload.sector_ids = [...new Set(sectorIds)];
  if (Array.isArray(industryIds)) payload.industry_ids = [...new Set(industryIds)];

  try {
    await api.put("/profile/preferences", payload);
  } catch (error) {
    if (!TUTORIAL_BYPASS_AUTH && !isDemoAccountEnabled()) throw error;
    console.warn("Preferences API unavailable; saved locally for tutorial mode.", error);
  }

  return {
    role: primaryRole,
    roles: selectedRoles,
    sectorIds: Array.isArray(sectorIds) ? payload.sector_ids : undefined,
    industryIds: Array.isArray(industryIds) ? payload.industry_ids : undefined,
    location: locationLabel || "Anywhere",
    locationData: normalizedLocationData,
  };
}
