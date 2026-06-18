import { toast } from "sonner";
import { api } from "./api";
import { hasGooglePlacesKey } from "../components/PlacesAutocomplete";

export async function saveTargetPreferences({ role, location, locationData }) {
  const trimmedRole = (role || "").trim();
  if (!trimmedRole) {
    toast.error("Please enter a job title");
    return null;
  }

  const trimmedLocation = (location || "").trim();
  if (hasGooglePlacesKey() && trimmedLocation && !locationData) {
    toast.error("Select a location from the suggestions");
    return null;
  }

  const locationLabel = locationData?.location_label || trimmedLocation;

  await api.put("/profile/preferences", {
    target_role: trimmedRole,
    target_roles: [trimmedRole],
    target_location: locationLabel,
    target_location_data: locationData,
  });

  return {
    role: trimmedRole,
    location: locationLabel || "Anywhere",
    locationData,
  };
}
