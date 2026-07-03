import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { api } from "../lib/api";
import { buildTypedLocationResult, searchLocationsClient } from "../lib/locationSearch";
import { isFrench, translateLocationLabel } from "../lib/localizedDisplay";

const EMPTY_SUGGESTIONS = [];

function isAbort(err) {
  return err?.name === "AbortError" || err?.code === "ERR_CANCELED";
}

function dedupeResults(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = (item.label || "").toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

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
  suggestions = EMPTY_SUGGESTIONS,
  compactChips = false,
  maxSuggestions,
  inline = false,
  hideLabel = false,
  onFieldFocus,
  onFieldBlur,
  lang = "en",
}) {
  const light = variant === "light";
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const [dropdownRect, setDropdownRect] = useState(null);
  const blurTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);
  const anchorRef = useRef(null);

  const visibleSuggestions = maxSuggestions ? suggestions.slice(0, maxSuggestions) : suggestions;
  const trimmedValue = (value || "").trim();
  const hasSelection = Boolean(
    selectedLocation?.location_label
    && selectedLocation.location_label === value,
  );

  const showSearchDropdown = focused
    && trimmedValue.length >= 2
    && !hasSelection;
  const showPopularDropdown = inline
    && focused
    && !trimmedValue
    && visibleSuggestions.length > 0;
  const showDropdown = showSearchDropdown || showPopularDropdown;

  const labelClass = light ? "text-sm font-semibold text-zinc-700" : "text-sm font-semibold text-zinc-200";
  const optionalClass = light ? "text-zinc-400 font-normal" : "text-sprout-dim font-normal";
  const inputClass = inline
    ? `h-auto min-h-0 border-0 bg-transparent p-0 pr-6 text-sm shadow-none focus-visible:ring-0 ${
      light ? "text-zinc-900 placeholder:text-zinc-400" : "text-white placeholder:text-sprout-dim"
    }`
    : light
    ? `h-11 rounded-xl bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 pr-10 ${focused ? "border-linkedin ring-2 ring-linkedin/20" : ""}`
    : `h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim pr-10`;
  const iconClass = inline
    ? "hidden"
    : light ? "w-4 h-4 text-zinc-400 absolute right-3 top-3.5" : "w-4 h-4 text-sprout-muted absolute right-3 top-3.5";
  const helperClass = light ? "text-xs text-zinc-500" : "text-xs text-sprout-muted";
  const dropdownClass = light
    ? "scrollbar-thin rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto"
    : "scrollbar-thin rounded-2xl border border-sprout-border bg-sprout-surface shadow-xl overflow-hidden max-h-60 overflow-y-auto";
  const optionClass = light
    ? "w-full text-left px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50 flex items-start gap-2.5"
    : "w-full text-left px-4 py-3 text-sm text-white hover:bg-sprout-mint-soft active:bg-sprout-mint-soft focus:bg-sprout-mint-soft focus:outline-none flex items-start gap-2.5";
  const chipOnClass = "selection-chip-on";
  const chipOffClass = light ? "selection-chip-off" : "selection-chip-off bg-zinc-50";

  const applyLocation = useCallback((location) => {
    setResults([]);
    setFocused(false);
    onSelect(location);
    onInputChange(location.location_label);
  }, [onInputChange, onSelect]);

  // Compute dropdown position using pageY offsets (works with mobile keyboard scroll)
  const updateDropdownRect = useCallback(() => {
    const node = anchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // getBoundingClientRect is relative to the visual viewport.
    // Adding pageY/pageX gives absolute document coords, correct for position:absolute on body.
    setDropdownRect({
      top: rect.bottom + (window.pageYOffset ?? window.scrollY ?? 0) + 4,
      left: rect.left + (window.pageXOffset ?? window.scrollX ?? 0),
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
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", updateDropdownRect);
      vv.addEventListener("scroll", updateDropdownRect);
    }
    return () => {
      window.removeEventListener("resize", updateDropdownRect);
      window.removeEventListener("scroll", updateDropdownRect, true);
      if (vv) {
        vv.removeEventListener("resize", updateDropdownRect);
        vv.removeEventListener("scroll", updateDropdownRect);
      }
    };
  }, [showDropdown, trimmedValue, updateDropdownRect]);

  useEffect(() => {
    if (!trimmedValue || hasSelection || trimmedValue.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setSearching(false);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    const localMatches = localSuggestionResults(trimmedValue, suggestions, 10);
    const typedNow = buildTypedLocationResult(trimmedValue);
    // Show local matches + typed entry immediately so there's always something visible
    const immediate = dedupeResults([...localMatches, ...typedNow]);
    setResults(immediate);
    setSearching(true);

    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Run backend and Photon client-side in parallel
        const safeBackend = api
          .get("/locations/search", {
            params: { q: trimmedValue, limit: 12 },
            timeout: 8000,
            signal: controller.signal,
          })
          .then((res) => res.data?.results || [])
          .catch((err) => {
            if (isAbort(err)) throw err;
            return [];
          });

        const safePhoton = searchLocationsClient(trimmedValue, 12, controller.signal).catch(
          (err) => {
            if (isAbort(err)) throw err;
            return [];
          },
        );

        const [backendResults, photonResults] = await Promise.all([safeBackend, safePhoton]);

        if (requestId !== requestIdRef.current) return;

        // Merge: backend first (higher quality), then Photon, then typed entry as anchor
        const typed = buildTypedLocationResult(trimmedValue);
        const merged = dedupeResults([...backendResults, ...photonResults, ...typed]);
        setResults(merged.length > 0 ? merged.slice(0, 12) : immediate);
      } catch (error) {
        if (requestId !== requestIdRef.current || isAbort(error)) return;
        // Both APIs failed — keep the immediate results (local + typed)
        setResults(immediate);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, 350);

    return () => {
      clearTimeout(handle);
      abortRef.current?.abort();
    };
  }, [trimmedValue, hasSelection, suggestions]);

  const helperText = useMemo(() => {
    if (isFrench(lang)) {
      if (trimmedValue && !hasSelection) return "Choisissez une ville dans la liste ci-dessous.";
      return optional ? "Facultatif" : "Tapez 2 lettres pour voir des suggestions";
    }
    if (trimmedValue && !hasSelection) return "Pick a city from the list below.";
    return optional ? "Optional" : "Type 2+ letters to see suggestions";
  }, [lang, optional, trimmedValue, hasSelection]);

  const handleChange = (next) => {
    onInputChange(next);
    onSelect(null);
  };

  const selectResult = (result) => {
    applyLocation(resultToLocation(result));
  };

  const selectSuggestion = async (suggestionLabel) => {
    setLoading(true);
    try {
      try {
        const { data } = await api.get("/locations/search", {
          params: { q: suggestionLabel, limit: 3 },
        });
        const match = data?.results?.[0];
        if (match) {
          applyLocation(resultToLocation(match));
          return;
        }
      } catch {
        // fall through to client search
      }

      try {
        const clientResults = await searchLocationsClient(suggestionLabel, 3);
        if (clientResults[0]) {
          applyLocation(resultToLocation(clientResults[0]));
          return;
        }
      } catch {
        // fall through to label-only selection
      }

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
    onFieldFocus?.();
  };

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => {
      setFocused(false);
      onFieldBlur?.();
    }, 150);
  };

  const isSuggestionSelected = (suggestionLabel) => {
    const selected = (selectedLocation?.location_label || value || "").toLowerCase();
    const city = suggestionLabel.split(",")[0].trim().toLowerCase();
    return selected.includes(city);
  };

  const kindLabel = (kind) => {
    if (!kind || kind === "geocode" || kind === "place") return null;
    const labels = {
      village: isFrench(lang) ? "Village" : "Village",
      hamlet: isFrench(lang) ? "Hameau" : "Hamlet",
      town: isFrench(lang) ? "Ville" : "Town",
      city: isFrench(lang) ? "Ville" : "City",
      municipality: isFrench(lang) ? "Commune" : "Municipality",
      county: isFrench(lang) ? "Département" : "Department / county",
      state: isFrench(lang) ? "Région / État" : "Region / state",
      region: isFrench(lang) ? "Région" : "Region",
      state_district: isFrench(lang) ? "District" : "District",
      suburb: isFrench(lang) ? "Quartier" : "Suburb",
      borough: isFrench(lang) ? "Arrondissement" : "Borough",
    };
    return labels[kind] || kind;
  };

  return (
    <div className={inline ? "min-w-0 flex-1" : "space-y-1.5"} data-testid={testId}>
      {!hideLabel && !inline && label ? (
      <Label className={labelClass}>
        {label} {optional && <span className={optionalClass}>({isFrench(lang) ? "facultatif" : "optional"})</span>}
      </Label>
      ) : null}
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
                  position: "absolute",
                  top: dropdownRect.top,
                  left: dropdownRect.left,
                  width: dropdownRect.width,
                  zIndex: 9999,
                }}
              >
                {showPopularDropdown ? (
                  <>
                    <p className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${light ? "text-zinc-400" : "text-sprout-muted"}`}>
                      {isFrench(lang) ? "Lieux populaires" : "Popular locations"}
                    </p>
                    {visibleSuggestions.slice(0, maxSuggestions || 10).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectSuggestion(suggestion)}
                        className={optionClass}
                        data-testid={`${testId}-popular-option`}
                        role="option"
                      >
                        <MapPin className={`w-4 h-4 shrink-0 mt-0.5 ${light ? "text-linkedin" : "text-sprout-mint"}`} />
                        <span className="block">{translateLocationLabel(suggestion, lang)}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {searching && results.length === 0 && (
                      <div className={`px-4 py-3 text-sm ${light ? "text-zinc-500" : "text-zinc-500"}`}>
                        {isFrench(lang) ? "Recherche..." : "Searching..."}
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
                            <span className="block">{translateLocationLabel(result.label, lang)}</span>
                            {badge ? (
                              <span className={`block text-xs mt-0.5 ${light ? "text-zinc-400" : "text-zinc-500"}`}>
                                {badge}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>,
              document.body,
            )
          : null}
      </div>
      {!inline ? <p className={helperClass}>{helperText}</p> : null}
      {!inline && visibleSuggestions.length > 0 && !trimmedValue && (
        <div className="pt-0.5">
          <p className={`text-[11px] font-medium mb-1.5 ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
            {isFrench(lang) ? "Lieux populaires" : "Popular locations"}
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
                  {translateLocationLabel(suggestion, lang)}
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
