import { toast } from "sonner";
import { api } from "./api";
import { isDemoAccountEnabled } from "./demoAccount";
import { TUTORIAL_BYPASS_AUTH } from "./dev";

const COUNTRY_CODE_BY_NAME = {
  france: "FR",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  "united states": "US",
  usa: "US",
  morocco: "MA",
  maroc: "MA",
  germany: "DE",
  spain: "ES",
  espana: "ES",
  italy: "IT",
  canada: "CA",
  belgium: "BE",
  switzerland: "CH",
  netherlands: "NL",
};

export function normalizeLocationData(location, locationData) {
  if (locationData?.location_label) return locationData;

  const trimmed = (location || "").trim();
  if (!trimmed) return null;

  const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  const country = parts.length > 1 ? parts[parts.length - 1] : "";

  return {
    location_label: trimmed,
    place_id: "",
    country,
    country_code: COUNTRY_CODE_BY_NAME[country.toLowerCase()] || "",
    lat: null,
    lng: null,
    source: "local",
  };
}

export async function saveTargetPreferences({ role, location, locationData }) {
  const trimmedRole = (role || "").trim();
  if (!trimmedRole) {
    toast.error("Please enter a job title");
    return null;
  }

  const trimmedLocation = (location || "").trim();
  const normalizedLocationData = normalizeLocationData(trimmedLocation, locationData);
  const locationLabel = normalizedLocationData?.location_label || trimmedLocation;

  const payload = {
    target_role: trimmedRole,
    target_roles: [trimmedRole],
    target_location: locationLabel,
    target_location_data: normalizedLocationData,
  };

  try {
    await api.put("/profile/preferences", payload);
  } catch (error) {
    if (!TUTORIAL_BYPASS_AUTH && !isDemoAccountEnabled()) throw error;
    console.warn("Preferences API unavailable; saved locally for tutorial mode.", error);
  }

  return {
    role: trimmedRole,
    location: locationLabel || "Anywhere",
    locationData: normalizedLocationData,
  };
}
