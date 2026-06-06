import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function localSuggestionResults(query, suggestionLabels, limit = 10) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return suggestionLabels
    .filter((label) => {
      const lower = label.toLowerCase();
      const city = lower.split(",")[0].trim();
      return lower.includes(q) || city.startsWith(q);
    })
    .slice(0, limit)
    .map((label) => ({
      id: `local:${label}`,
      label,
      source: "local",
      place_id: "",
      country: label.split(",").slice(-1)[0]?.trim() || "",
      country_code: "",
      lat: null,
      lng: null,
      kind: "city",
    }));
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
  compactChips = false,
  maxSuggestions,
}) {
  const light = variant === "light";
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [results, setResults] = useState([]);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const blurTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);
  const anchorRef = useRef(null);
  const [dropdownRect, setDropdownRect] = useState(null);

  const visibleSuggestions = maxSuggestions ? suggestions.slice(0, maxSuggestions) : suggestions;
  const trimmedValue = (value || "").trim();
  const hasSelection = Boolean(
    selectedLocation?.location_label
    && selectedLocation.location_label === value,
  );
  const isInvalid = touched && trimmedValue && !hasSelection;

  const showDropdown = focused
    && trimmedValue.length >= 1
    && !hasSelection;

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
    ? "rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto"
    : "rounded-2xl border border-sprout-border bg-sprout-surface shadow-xl overflow-hidden max-h-60 overflow-y-auto";
  const optionClass = light
    ? "w-full text-left px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50 flex items-start gap-2.5"
    : "w-full text-left px-4 py-3 text-sm text-zinc-100 hover:bg-sprout-surface-2 flex items-start gap-2.5";
  const chipOnClass = "selection-chip-on";
  const chipOffClass = light ? "selection-chip-off" : "selection-chip-off bg-zinc-50";

  const applyLocation = useCallback((location) => {
    setResults([]);
    setTouched(false);
    setFocused(false);
    onSelect(location);
    onInputChange(location.location_label);
  }, [onInputChange, onSelect]);

  const updateDropdownRect = useCallback(() => {
    const node = anchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showDropdown) {
      setDropdownRect(null);
      return undefined;
    }
    updateDropdownRect();
    window.addEventListener("resize", updateDropdownRect);
    window.addEventListener("scroll", updateDropdownRect, true);
    return () => {
      window.removeEventListener("resize", updateDropdownRect);
      window.removeEventListener("scroll", updateDropdownRect, true);
    };
  }, [showDropdown, trimmedValue, updateDropdownRect]);

  useEffect(() => {
    if (!trimmedValue || hasSelection) {
      abortRef.current?.abort();
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    const fallback = localSuggestionResults(trimmedValue, suggestions, 10);
    setSearching(true);
    setSearchError(false);
    setResults(fallback);

    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { data } = await api.get("/locations/search", {
          params: { q: trimmedValue, limit: 12 },
          timeout: 20000,
          signal: controller.signal,
        });
        if (requestId !== requestIdRef.current) return;
        const apiResults = data?.results || [];
        setResults(apiResults.length > 0 ? apiResults : fallback);
        setSearchError(apiResults.length === 0 && fallback.length === 0);
      } catch (error) {
        if (requestId !== requestIdRef.current || error?.code === "ERR_CANCELED") return;
        setResults(fallback);
        setSearchError(fallback.length === 0);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, 200);

    return () => {
      clearTimeout(handle);
      abortRef.current?.abort();
    };
  }, [trimmedValue, hasSelection, suggestions]);

  const helperText = useMemo(() => {
    if (isInvalid) return "Select one of the suggested locations.";
    if (trimmedValue) return "Pick a city, town, village, or region from the list.";
    return optional ? "Optional" : "Start typing any city, town, or village worldwide";
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
      <div className="relative" ref={anchorRef}>
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

        {showDropdown && dropdownRect && typeof document !== "undefined"
          ? createPortal(
              <div
                className={dropdownClass}
                role="listbox"
                style={{
                  position: "fixed",
                  top: dropdownRect.top,
                  left: dropdownRect.left,
                  width: dropdownRect.width,
                  zIndex: 9999,
                }}
              >
                {searching && results.length === 0 && (
                  <div className={`px-4 py-3 text-sm ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
                    Searching cities, towns, and villages…
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
                    {searchError
                      ? "Location service unavailable. Start the backend server or pick a popular location below."
                      : "No locations found. Try a nearby city or region name."}
                  </div>
                )}
              </div>,
              document.body,
            )
          : null}
      </div>
      <p className={helperClass}>{helperText}</p>
      {visibleSuggestions.length > 0 && !trimmedValue && (
        <div className="pt-0.5">
          <p className={`text-[11px] font-medium mb-1.5 ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
            Popular locations
          </p>
          <div className={`flex flex-wrap ${compactChips ? "gap-1.5" : "gap-2"}`}>
            {visibleSuggestions.map((suggestion) => {
              const on = isSuggestionSelected(suggestion);
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => selectSuggestion(suggestion)}
                  className={`inline-flex items-center gap-1 border font-medium transition-all duration-200 ease-out active:scale-[0.97] rounded-full ${
                    compactChips ? "px-2 py-1 text-[11px] sm:text-xs" : "gap-1.5 px-3 py-2 text-sm"
                  } ${on ? chipOnClass : chipOffClass}`}
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
