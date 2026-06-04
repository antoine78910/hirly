import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const GOOGLE_MAPS_SRC = "https://maps.googleapis.com/maps/api/js";
let googleMapsPromise = null;

function loadGoogleMaps(apiKey) {
  if (!apiKey) return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-google-places]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", reject);
      return;
    }

    const script = document.createElement("script");
    script.src = `${GOOGLE_MAPS_SRC}?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googlePlaces = "true";
    script.onload = () => resolve(window.google);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function placeToLocation(place, fallbackLabel) {
  const countryComponent = place.address_components?.find((c) => c.types?.includes("country"));
  const lat = place.geometry?.location?.lat?.();
  const lng = place.geometry?.location?.lng?.();
  return {
    location_label: place.formatted_address || place.name || fallbackLabel || "",
    place_id: place.place_id || "",
    country: countryComponent?.long_name || "",
    country_code: (countryComponent?.short_name || "").toLowerCase(),
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
  };
}

export default function PlacesAutocomplete({
  label,
  value,
  selectedLocation,
  onInputChange,
  onSelect,
  placeholder = "Search for a city or country",
  optional = false,
  testId,
}) {
  const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [touched, setTouched] = useState(false);
  const serviceRef = useRef(null);
  const placesNodeRef = useRef(null);
  const placesServiceRef = useRef(null);
  const sessionRef = useRef(null);

  const hasGoogleKey = Boolean(apiKey);
  const isInvalid = hasGoogleKey && touched && value && selectedLocation?.location_label !== value;

  useEffect(() => {
    if (!apiKey) {
      if (process.env.NODE_ENV === "development") {
        console.warn("REACT_APP_GOOGLE_MAPS_API_KEY is missing. Location inputs are using free-text fallback.");
      }
      return;
    }
    loadGoogleMaps(apiKey)
      .then((google) => {
        if (!google?.maps?.places) return;
        serviceRef.current = new google.maps.places.AutocompleteService();
        placesNodeRef.current = document.createElement("div");
        placesServiceRef.current = new google.maps.places.PlacesService(placesNodeRef.current);
        sessionRef.current = new google.maps.places.AutocompleteSessionToken();
        setReady(true);
      })
      .catch(() => {
        if (process.env.NODE_ENV === "development") {
          console.warn("Google Places failed to load. Location inputs are using free-text fallback.");
        }
      });
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !value || selectedLocation?.location_label === value) {
      setPredictions([]);
      return;
    }

    const handle = setTimeout(() => {
      serviceRef.current?.getPlacePredictions(
        {
          input: value,
          types: ["(regions)"],
          sessionToken: sessionRef.current,
        },
        (results, status) => {
          if (status !== window.google.maps.places.PlacesServiceStatus.OK || !results) {
            setPredictions([]);
            return;
          }
          setPredictions(results.slice(0, 5));
        },
      );
    }, 180);
    return () => clearTimeout(handle);
  }, [ready, selectedLocation, value]);

  const helperText = useMemo(() => {
    if (!hasGoogleKey) return "Google Places is not configured. Free-text fallback is enabled.";
    if (isInvalid) return "Select one of the suggested locations.";
    return optional ? "Optional" : "Required";
  }, [hasGoogleKey, isInvalid, optional]);

  const selectPrediction = (prediction) => {
    setLoading(true);
    placesServiceRef.current.getDetails(
      {
        placeId: prediction.place_id,
        fields: ["place_id", "formatted_address", "name", "address_components", "geometry"],
        sessionToken: sessionRef.current,
      },
      (place, status) => {
        setLoading(false);
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) return;
        const location = placeToLocation(place, prediction.description);
        setPredictions([]);
        setTouched(false);
        onSelect(location);
        sessionRef.current = new window.google.maps.places.AutocompleteSessionToken();
      },
    );
  };

  const handleChange = (next) => {
    setTouched(true);
    onInputChange(next);
    if (hasGoogleKey) onSelect(null);
  };

  return (
    <div className="space-y-1.5 relative" data-testid={testId}>
      <Label className="text-sm font-semibold text-zinc-200">
        {label} {optional && <span className="text-sprout-dim font-normal">(optional)</span>}
      </Label>
      <div className="relative">
        <Input
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className={`h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim pr-10 ${isInvalid ? "border-rose-500" : ""}`}
          data-testid={`${testId}-input`}
        />
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-sprout-muted absolute right-3 top-3.5" />
        ) : (
          <MapPin className="w-4 h-4 text-sprout-muted absolute right-3 top-3.5" />
        )}
      </div>
      <p className={`text-xs ${isInvalid ? "text-rose-300" : "text-sprout-muted"}`}>{helperText}</p>
      {predictions.length > 0 && (
        <div className="absolute z-[90] mt-1 w-full rounded-2xl border border-sprout-border bg-sprout-surface shadow-xl overflow-hidden">
          {predictions.map((p) => (
            <button
              key={p.place_id}
              type="button"
              onClick={() => selectPrediction(p)}
              className="w-full text-left px-4 py-3 text-sm text-zinc-100 hover:bg-sprout-surface-2"
              data-testid={`${testId}-option`}
            >
              {p.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function hasGooglePlacesKey() {
  return Boolean(process.env.REACT_APP_GOOGLE_MAPS_API_KEY);
}
