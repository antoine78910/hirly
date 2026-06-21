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

  const handleChange = ([next]) => {
    onChange?.(radiusFromKm(next));
  };

  if (variant === "compact") {
    return (
      <div
        className={`flex min-w-[148px] max-w-[196px] flex-col justify-center gap-1.5 rounded-xl border px-3 py-2 ${className}`}
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatSearchRadius(value)}
          </span>
        </div>
        <Slider
          min={MIN_SEARCH_RADIUS_KM}
          max={MAX_SEARCH_RADIUS_KM}
          step={1}
          value={[radiusKm]}
          onValueChange={handleChange}
          className="py-0.5"
          aria-label={label}
        />
      </div>
    );
  }

  return (
    <section data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl font-bold text-inherit">{label}</h3>
        <span className="text-sm font-semibold text-linkedin">{formatSearchRadius(value)}</span>
      </div>
      <Slider
        min={MIN_SEARCH_RADIUS_KM}
        max={MAX_SEARCH_RADIUS_KM}
        step={1}
        value={[radiusKm]}
        onValueChange={handleChange}
        aria-label={label}
      />
      <div className="mt-2 flex justify-between text-[11px] text-sprout-muted">
        <span>{MIN_SEARCH_RADIUS_KM} km</span>
        <span>{MAX_SEARCH_RADIUS_KM} km</span>
      </div>
    </section>
  );
}
