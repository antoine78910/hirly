import { useEffect, useRef, useState } from "react";
import {
  formatSearchRadius,
  MAX_SEARCH_RADIUS_KM,
  MIN_SEARCH_RADIUS_KM,
  radiusFromKm,
  radiusToKm,
} from "../../lib/jobFilters";
import { Slider } from "../ui/slider";

/** Search distance control — compact (desktop bar) or full (filters sheet). */
export default function SearchRadiusSlider({
  value,
  onChange,
  variant = "compact",
  label = "Distance",
  className = "",
  testId = "search-radius-slider",
}) {
  const radiusKm = radiusToKm(value);
  const [expanded, setExpanded] = useState(false);
  const [liveRadiusKm, setLiveRadiusKm] = useState(radiusKm);
  const rootRef = useRef(null);

  useEffect(() => {
    setLiveRadiusKm(radiusKm);
  }, [radiusKm]);

  // onValueChange fires continuously on every drag tick -- only update the
  // displayed number here, never the parent. A single drag can fire 100+ of
  // these; if each one called onChange (which triggers a full feed reload in
  // Swipe.jsx), the feed gets reset mid-request over and over and never
  // finishes loading (confirmed: one user's drag fired 154 reloads in ~30s).
  // onValueCommit fires once, when the drag/keypress interaction ends, which
  // is the right moment to actually apply the new radius.
  const handleLiveChange = ([next]) => {
    setLiveRadiusKm(next);
  };

  const handleCommit = ([next]) => {
    onChange?.(radiusFromKm(next));
  };

  const displayValue = radiusFromKm(liveRadiusKm);

  useEffect(() => {
    if (!expanded) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [expanded]);

  if (variant === "compact") {
    return (
      <div
        ref={rootRef}
        className={`flex min-w-[132px] flex-col justify-center rounded-xl border px-3 py-2 ${className}`}
        data-testid={testId}
      >
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full items-center justify-between gap-2 text-left text-xs"
          aria-expanded={expanded}
          data-testid={`${testId}-toggle`}
        >
          <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatSearchRadius(displayValue)}
          </span>
        </button>
        {expanded ? (
          <Slider
            min={MIN_SEARCH_RADIUS_KM}
            max={MAX_SEARCH_RADIUS_KM}
            step={1}
            value={[liveRadiusKm]}
            onValueChange={handleLiveChange}
            onValueCommit={handleCommit}
            className="mt-2 py-0.5"
            aria-label={label}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl font-bold text-inherit">{label}</h3>
        <span className="text-sm font-semibold text-linkedin">
          {formatSearchRadius(displayValue)}
        </span>
      </div>
      <Slider
        min={MIN_SEARCH_RADIUS_KM}
        max={MAX_SEARCH_RADIUS_KM}
        step={1}
        value={[liveRadiusKm]}
        onValueChange={handleLiveChange}
        onValueCommit={handleCommit}
        aria-label={label}
      />
      <div className="mt-2 flex justify-between text-[11px] text-sprout-muted">
        <span>{MIN_SEARCH_RADIUS_KM} km</span>
        <span>{MAX_SEARCH_RADIUS_KM} km</span>
      </div>
    </section>
  );
}
