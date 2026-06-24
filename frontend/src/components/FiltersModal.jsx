import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Info } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "../components/ui/switch";
import PlacesAutocomplete, { hasGooglePlacesKey } from "./PlacesAutocomplete";
import { formatMinSalary } from "../lib/jobFilters";
import SearchRadiusSlider from "./swipe/SearchRadiusSlider";
import { useAppLocale } from "../context/AppLocaleContext";

/**
 * Sprout-style Filters sheet — matches Swipper reference screenshots.
 * Pure UI for now: state is local and surfaced via onApply(filters).
 * The "300+ jobs" count is a soft placeholder until we wire it to the feed query.
 */

const DATE_OPTIONS = [
  { value: "any",     label: "Any time"        },
  { value: "1d",      label: "Past 24 hours"   },
  { value: "7d",      label: "Past week"       },
  { value: "30d",     label: "Past month"      },
];

const WORK_LOCATIONS = ["onsite", "hybrid", "remote"];
const WORK_LABELS    = { onsite: "In Person", hybrid: "Hybrid", remote: "Remote" };

const JOB_TYPES   = ["full_time", "part_time", "internship"];
const JOB_LABELS  = { full_time: "Full Time", part_time: "Part Time", internship: "Internship" };

const EXPERIENCE  = ["entry", "mid", "senior", "executive"];
const EXP_LABELS  = { entry: "Entry Level", mid: "Mid Level", senior: "Senior Level", executive: "Executive Level" };

const DEFAULT = {
  minSalary: 0,
  postedDate: "any",
  workLocations: [],
  jobTypes: [],
  experience: [],
  locations: [],
  locationData: null,
  locationsData: [],
  onlyCompanies: [],
  hideCompanies: [],
  onlyIndustries: [],
  hideIndustries: [],
  includeUnknownLocation: true,
  includeUnknownSalary: true,
  searchRadius: "50km",
  onlyMyCountry: false,
};

const locationKey = (loc) => {
  const placeId = String(loc?.place_id || "").trim();
  if (placeId) return `place:${placeId}`;
  return `label:${String(loc?.location_label || "").trim().toLowerCase()}`;
};

const sel = {
  chipOn: "bg-sprout-mint text-white shadow-sm",
  chipOff: "border border-sprout-border bg-sprout-surface-2 text-sprout-muted hover:border-sprout-mint/60 hover:text-white",
  optionOn: "bg-sprout-mint text-white",
  optionOff: "border border-sprout-border bg-sprout-surface-2 text-sprout-muted hover:border-sprout-mint/60 hover:text-white",
  checkDot: "grid h-5 w-5 place-items-center rounded-full bg-white text-sprout-mint",
  tag: "inline-flex items-center gap-1 rounded-full border border-sprout-border bg-sprout-surface-2 px-2.5 py-1 text-xs text-sprout-muted",
};

function Chip({ active, children, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`px-4 py-2 rounded-full text-sm font-medium ${
        active ? sel.chipOn : sel.chipOff
      }`}
    >
      {children}
    </button>
  );
}

function RadioRow({ active, label, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full h-12 px-4 rounded-2xl flex items-center justify-between text-left ${
        active ? sel.optionOn : sel.optionOff
      }`}
    >
      <span className="font-medium">{label}</span>
      {active && (
        <span className={sel.checkDot}>
          <svg viewBox="0 0 20 20" className="w-3 h-3" fill="currentColor"><path d="M7.5 13l-3-3 1.4-1.4L7.5 10.2l6.6-6.6L15.5 5z" /></svg>
        </span>
      )}
    </button>
  );
}

function TagInput({ value, onAdd, onRemove, placeholder, testId }) {
  const [draft, setDraft] = useState("");
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 h-11 rounded-full bg-sprout-surface-2 border border-sprout-border text-white placeholder:text-sprout-dim px-4 text-sm outline-none focus:border-sprout-mint"
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) { onAdd(draft.trim()); setDraft(""); }
          }}
        />
        <button
          type="button"
          onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(""); } }}
          className="h-11 px-5 rounded-full bg-sprout-mint text-white font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className={sel.tag}>
              {v}
              <button type="button" onClick={() => onRemove(v)} className="hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FiltersModal({ open, initialFilters, totalCount, onApply, onReset, onClose }) {
  const { lang } = useAppLocale();
  const [f, setF] = useState({ ...DEFAULT, ...(initialFilters || {}) });
  const [locationDraft, setLocationDraft] = useState("");

  useEffect(() => {
    if (open) {
      const next = { ...DEFAULT, ...(initialFilters || {}) };
      if (next.locationData && (!next.locationsData || next.locationsData.length === 0)) {
        next.locationsData = [next.locationData];
      }
      setF(next);
      setLocationDraft("");
    }
  }, [open, initialFilters]);

  const toggleArr = (key, val) =>
    setF((s) => {
      const arr = s[key].includes(val) ? s[key].filter((x) => x !== val) : [...s[key], val];
      return { ...s, [key]: arr };
    });

  if (!open) return null;

  const selectedLocations = f.locationsData || [];
  const removeLocation = (keyToRemove) => {
    setF((s) => {
      const nextLocations = (s.locationsData || []).filter((loc) => locationKey(loc) !== keyToRemove);
      return {
        ...s,
        locationsData: nextLocations,
        locationData: nextLocations[0] || null,
        locations: nextLocations.map((loc) => loc.location_label),
      };
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="sprout fixed inset-0 z-[60] bg-sprout-bg text-white overflow-y-auto"
        data-testid="filters-modal"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-sprout-border bg-sprout-bg/95 pt-safe backdrop-blur-xl">
          <div className="mx-auto flex max-w-md items-center justify-between px-safe py-3 sm:px-5 sm:py-4">
            <button onClick={onClose} className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface" data-testid="filters-close">
              <X className="w-5 h-5 text-white" />
            </button>
            <h2 className="font-display font-bold text-xl">Filters</h2>
            <span className="w-10" />
          </div>
        </div>

        <div className="mx-auto max-w-md space-y-8 px-safe pb-56 pt-6 sm:px-5">
          {/* Salary */}
          <section>
            <div className="flex items-center gap-1.5">
              <h3 className="font-display font-bold text-2xl">Minimum Salary</h3>
              <Info className="w-4 h-4 text-sprout-mint" />
            </div>
            <div className="mt-3 flex justify-between text-sm text-zinc-200">
              <span>{formatMinSalary(0, lang)}</span>
              <span>{formatMinSalary(250_000, lang)}</span>
            </div>
            <input
              type="range" min="0" max="250000" step="5000"
              value={f.minSalary}
              onChange={(e) => setF((s) => ({ ...s, minSalary: Number(e.target.value) }))}
              className="mt-2 w-full accent-[#5EE5B5]"
              data-testid="filters-salary-slider"
            />
            <p className="mt-1 text-xs text-sprout-muted">Current: <span className="text-sprout-mint font-semibold">{formatMinSalary(f.minSalary, lang)}</span></p>
          </section>

          {/* Date */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Posted Date</h3>
            <div className="space-y-2.5">
              {DATE_OPTIONS.map((d) => (
                <RadioRow
                  key={d.value}
                  active={f.postedDate === d.value}
                  label={d.label}
                  onClick={() => setF((s) => ({ ...s, postedDate: d.value }))}
                  testId={`filters-date-${d.value}`}
                />
              ))}
            </div>
          </section>

          {/* Work Location */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Work Location Type</h3>
            <div className="flex flex-wrap gap-2">
              {WORK_LOCATIONS.map((w) => (
                <Chip key={w} active={f.workLocations.includes(w)} onClick={() => toggleArr("workLocations", w)} testId={`filters-work-${w}`}>
                  {WORK_LABELS[w]}
                </Chip>
              ))}
            </div>
          </section>

          {/* Job Type */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Job Type</h3>
            <div className="flex flex-wrap gap-2">
              {JOB_TYPES.map((j) => (
                <Chip key={j} active={f.jobTypes.includes(j)} onClick={() => toggleArr("jobTypes", j)} testId={`filters-job-${j}`}>
                  {JOB_LABELS[j]}
                </Chip>
              ))}
            </div>
          </section>

          {/* Experience */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Experience Level</h3>
            <div className="flex flex-wrap gap-2">
              {EXPERIENCE.map((e) => (
                <Chip key={e} active={f.experience.includes(e)} onClick={() => toggleArr("experience", e)} testId={`filters-exp-${e}`}>
                  {EXP_LABELS[e]}
                </Chip>
              ))}
            </div>
          </section>

          {/* Locations — cities/countries the user wants to target */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Locations</h3>
            <p className="text-sm text-sprout-muted -mt-2 mb-3">Choose a city, region, or country for this feed.</p>
            {hasGooglePlacesKey() ? (
              <div className="space-y-3">
                <PlacesAutocomplete
                  label="Add location"
                  optional
                  value={locationDraft}
                  selectedLocation={null}
                  onInputChange={setLocationDraft}
                  onSelect={(loc) => {
                    if (!loc) return;
                    setF((s) => {
                      const existing = s.locationsData || [];
                      const key = locationKey(loc);
                      if (existing.some((item) => locationKey(item) === key)) return s;
                      const nextLocations = [...existing, loc];
                      return {
                        ...s,
                        locationsData: nextLocations,
                        locationData: nextLocations[0] || null,
                        locations: nextLocations.map((item) => item.location_label),
                      };
                    });
                    setLocationDraft("");
                  }}
                  placeholder="Search for a city or country"
                  testId="filters-locations"
                />
                {selectedLocations.length > 0 && (
                  <div className="space-y-2">
                    {selectedLocations.map((loc) => (
                      <div
                        key={loc.place_id || loc.location_label}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-sprout-border bg-sprout-surface-2 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{loc.location_label}</p>
                          <p className="text-xs text-sprout-muted truncate">{loc.country || loc.country_code || "Selected location"}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLocation(locationKey(loc))}
                          className="w-8 h-8 rounded-full grid place-items-center text-sprout-muted hover:text-white hover:bg-sprout-surface"
                          aria-label={`Remove ${loc.location_label}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <TagInput
                value={f.locations}
                placeholder="e.g. Remote, Berlin, New York"
                onAdd={(v) => setF((s) => ({ ...s, locations: [...new Set([...s.locations, v])] }))}
                onRemove={(v) => setF((s) => ({ ...s, locations: s.locations.filter((x) => x !== v) }))}
                testId="filters-locations"
              />
            )}
          </section>

          <SearchRadiusSlider
            variant="full"
            label="Search Distance"
            value={f.searchRadius}
            onChange={(searchRadius) => setF((s) => ({ ...s, searchRadius }))}
            testId="filters-radius-slider"
          />

          <section>
            <label className="flex items-center justify-between text-white">
              <span className="font-semibold">Only search in my country</span>
              <Switch
                checked={f.onlyMyCountry}
                onCheckedChange={(v) => setF((s) => ({ ...s, onlyMyCountry: v }))}
                data-testid="filters-only-my-country"
              />
            </label>
          </section>

          {/* Only / hide companies */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Only Show Jobs From</h3>
            <TagInput
              value={f.onlyCompanies}
              placeholder="Company name"
              onAdd={(v) => setF((s) => ({ ...s, onlyCompanies: [...new Set([...s.onlyCompanies, v])] }))}
              onRemove={(v) => setF((s) => ({ ...s, onlyCompanies: s.onlyCompanies.filter((x) => x !== v) }))}
              testId="filters-only-companies"
            />
          </section>
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Hide Jobs From</h3>
            <TagInput
              value={f.hideCompanies}
              placeholder="Company name"
              onAdd={(v) => setF((s) => ({ ...s, hideCompanies: [...new Set([...s.hideCompanies, v])] }))}
              onRemove={(v) => setF((s) => ({ ...s, hideCompanies: s.hideCompanies.filter((x) => x !== v) }))}
              testId="filters-hide-companies"
            />
          </section>

          {/* Only / hide industries */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Only Show Jobs In</h3>
            <TagInput
              value={f.onlyIndustries}
              placeholder="Industry name"
              onAdd={(v) => setF((s) => ({ ...s, onlyIndustries: [...new Set([...s.onlyIndustries, v])] }))}
              onRemove={(v) => setF((s) => ({ ...s, onlyIndustries: s.onlyIndustries.filter((x) => x !== v) }))}
              testId="filters-only-industries"
            />
          </section>
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Hide Jobs In</h3>
            <TagInput
              value={f.hideIndustries}
              placeholder="Industry name"
              onAdd={(v) => setF((s) => ({ ...s, hideIndustries: [...new Set([...s.hideIndustries, v])] }))}
              onRemove={(v) => setF((s) => ({ ...s, hideIndustries: s.hideIndustries.filter((x) => x !== v) }))}
              testId="filters-hide-industries"
            />
          </section>

          {/* Additional filters */}
          <section>
            <h3 className="font-display font-bold text-2xl mb-3">Additional Filters</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between text-white">
                <span>Include unknown location type</span>
                <Switch
                  checked={f.includeUnknownLocation}
                  onCheckedChange={(v) => setF((s) => ({ ...s, includeUnknownLocation: v }))}
                  data-testid="filters-unknown-location"
                />
              </label>
              <label className="flex items-center justify-between text-white">
                <span>Include unknown salary range</span>
                <Switch
                  checked={f.includeUnknownSalary}
                  onCheckedChange={(v) => setF((s) => ({ ...s, includeUnknownSalary: v }))}
                  data-testid="filters-unknown-salary"
                />
              </label>
            </div>
          </section>
        </div>

        {/* Floating apply bar with mobile safe-area padding */}
        <div className="fixed bottom-0 inset-x-0 z-20 pt-3 bg-sprout-bg/95 backdrop-blur-xl border-t border-sprout-border" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)" }}>
          <div className="max-w-md mx-auto px-5">
            <div className="flex justify-center -mt-7 mb-3">
              <span className="px-3 py-1 rounded-full bg-sprout-mint text-white text-xs font-bold" data-testid="filters-count">
                {totalCount ?? "—"} jobs
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setF(DEFAULT);
                  setLocationDraft("");
                  if (onReset) onReset();
                }}
                className="flex-1 h-12 rounded-full bg-sprout-surface-2 border border-sprout-border text-sprout-mint font-semibold"
                data-testid="filters-clear"
              >
                Clear
              </button>
              <button
                onClick={() => {
                  if (hasGooglePlacesKey() && locationDraft && !f.locationData) {
                    toast.error("Select a location from the suggestions");
                    return;
                  }
                  onApply(f);
                }}
                className="flex-1 h-12 rounded-full bg-sprout-mint text-white font-semibold"
                data-testid="filters-apply"
              >
                Apply filters
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
