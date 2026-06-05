import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { api } from "../lib/api";

function resultToLocation(result) {
  return {
    location_label: result.label || "",
    place_id: result.place_id || "",
    country: result.country || "",
    country_code: result.country_code || "",
    lat: result.lat ?? null,
    lng: result.lng ?? null,
    source: result.source || "",
    kind: result.kind || "",
  };
}

export default function PlacesAutocomplete({
  label,
  value,
  selectedLocation,
  onInputChange,
  onSelect,
  placeholder = "Search for a city, town, or region",
  optional = false,
  testId,
  variant = "dark",
  suggestions = [],
}) {
  const light = variant === "light";
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const blurTimerRef = useRef(null);
  const requestIdRef = useRef(0);

  const trimmedValue = (value || "").trim();
  const hasSelection = Boolean(
    selectedLocation?.location_label
    && selectedLocation.location_label === value,
  );
  const isInvalid = touched && trimmedValue && !hasSelection;

  const showDropdown = focused
    && trimmedValue.length >= 1
    && !hasSelection
    && (searching || results.length > 0);

  const labelClass = light ? "text-sm font-semibold text-zinc-700" : "text-sm font-semibold text-zinc-200";
  const optionalClass = light ? "text-zinc-400 font-normal" : "text-sprout-dim font-normal";
  const inputClass = light
    ? `h-11 rounded-xl bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 pr-10 ${isInvalid ? "border-rose-500" : focused ? "border-linkedin ring-2 ring-linkedin/20" : ""}`
    : `h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim pr-10 ${isInvalid ? "border-rose-500" : ""}`;
  const iconClass = light ? "w-4 h-4 text-zinc-400 absolute right-3 top-3.5" : "w-4 h-4 text-sprout-muted absolute right-3 top-3.5";
  const helperClass = light
    ? `text-xs ${isInvalid ? "text-rose-500" : "text-zinc-500"}`
    : `text-xs ${isInvalid ? "text-rose-300" : "text-sprout-muted"}`;
  const dropdownClass = light
    ? "absolute z-[90] left-0 right-0 top-full mt-1 rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto"
    : "absolute z-[90] left-0 right-0 top-full mt-1 rounded-2xl border border-sprout-border bg-sprout-surface shadow-xl overflow-hidden max-h-60 overflow-y-auto";
  const optionClass = light
    ? "w-full text-left px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50 flex items-start gap-2.5"
    : "w-full text-left px-4 py-3 text-sm text-zinc-100 hover:bg-sprout-surface-2 flex items-start gap-2.5";
  const chipOnClass = light
    ? "bg-linkedin text-white border-linkedin shadow-sm"
    : "bg-sprout-mint text-white border-sprout-mint";
  const chipOffClass = light
    ? "bg-white text-linkedin border-zinc-200 hover:border-linkedin/40 hover:bg-linkedin-light/50"
    : "bg-sprout-surface-2 text-zinc-200 border-sprout-border hover:border-sprout-border-2";

  const applyLocation = useCallback((location) => {
    setResults([]);
    setTouched(false);
    setFocused(false);
    onSelect(location);
    onInputChange(location.location_label);
  }, [onInputChange, onSelect]);

  useEffect(() => {
    if (!trimmedValue || hasSelection) {
      setResults([]);
      setSearching(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setSearching(true);

    const handle = setTimeout(async () => {
      try {
        const { data } = await api.get("/locations/search", {
          params: { q: trimmedValue, limit: 10 },
        });
        if (requestId !== requestIdRef.current) return;
        setResults(data?.results || []);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, 280);

    return () => clearTimeout(handle);
  }, [trimmedValue, hasSelection]);

  const helperText = useMemo(() => {
    if (isInvalid) return "Select one of the suggested locations.";
    if (trimmedValue) return "Pick a city, town, department, or region from the list.";
    return optional ? "Optional" : "Start typing any city or region worldwide";
  }, [isInvalid, optional, trimmedValue]);

  const handleChange = (next) => {
    setTouched(true);
    onInputChange(next);
    onSelect(null);
  };

  const selectResult = (result) => {
    applyLocation(resultToLocation(result));
  };

  const selectSuggestion = async (suggestionLabel) => {
    setLoading(true);
    try {
      const { data } = await api.get("/locations/search", {
        params: { q: suggestionLabel, limit: 3 },
      });
      const match = data?.results?.[0];
      if (match) {
        applyLocation(resultToLocation(match));
        return;
      }
      applyLocation({
        location_label: suggestionLabel,
        place_id: "",
        country: "",
        country_code: "",
        lat: null,
        lng: null,
      });
    } catch {
      applyLocation({
        location_label: suggestionLabel,
        place_id: "",
        country: "",
        country_code: "",
        lat: null,
        lng: null,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setFocused(true);
  };

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => setFocused(false), 150);
  };

  const isSuggestionSelected = (suggestionLabel) => {
    const selected = (selectedLocation?.location_label || value || "").toLowerCase();
    const city = suggestionLabel.split(",")[0].trim().toLowerCase();
    return selected.includes(city);
  };

  const kindLabel = (kind) => {
    if (!kind || kind === "geocode" || kind === "place") return null;
    const labels = {
      village: "Village",
      hamlet: "Hamlet",
      town: "Town",
      city: "City",
      municipality: "Municipality",
      county: "Department / county",
      state: "Region / state",
      region: "Region",
      state_district: "District",
      suburb: "Suburb",
      borough: "Borough",
    };
    return labels[kind] || kind;
  };

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <Label className={labelClass}>
        {label} {optional && <span className={optionalClass}>(optional)</span>}
      </Label>
      <div className="relative">
        <Input
          value={value || ""}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={inputClass}
          data-testid={`${testId}-input`}
          autoComplete="off"
        />
        {loading || searching ? (
          <Loader2 className={`${iconClass} animate-spin`} />
        ) : (
          <MapPin className={iconClass} />
        )}

        {showDropdown && (
          <div className={dropdownClass} role="listbox">
            {searching && results.length === 0 && (
              <div className={`px-4 py-3 text-sm ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
                Searching worldwide locations…
              </div>
            )}
            {results.map((result) => {
              const badge = kindLabel(result.kind);
              return (
                <button
                  key={result.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectResult(result)}
                  className={optionClass}
                  data-testid={`${testId}-option`}
                  role="option"
                >
                  <MapPin className={`w-4 h-4 shrink-0 mt-0.5 ${light ? "text-linkedin" : "text-sprout-mint"}`} />
                  <span className="min-w-0">
                    <span className="block">{result.label}</span>
                    {badge ? (
                      <span className={`block text-xs mt-0.5 ${light ? "text-zinc-400" : "text-sprout-muted"}`}>
                        {badge}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {!searching && results.length === 0 && (
              <div className={`px-4 py-3 text-sm ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
                No locations found. Try a nearby city or region name.
              </div>
            )}
          </div>
        )}
      </div>
      <p className={helperClass}>{helperText}</p>
      {suggestions.length > 0 && !trimmedValue && (
        <div className="pt-1">
          <p className={`text-xs font-medium mb-2 ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
            Popular locations
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => {
              const on = isSuggestionSelected(suggestion);
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => selectSuggestion(suggestion)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border transition-all ${
                    on ? chipOnClass : chipOffClass
                  }`}
                  data-testid={`${testId}-suggestion`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {suggestion}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Location must be picked from search results (worldwide API). */
export function hasGooglePlacesKey() {
  return true;
}
