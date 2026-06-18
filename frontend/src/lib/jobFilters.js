export const DEFAULT_SEARCH_RADIUS = "50km";

export const DATE_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "1d", label: "Past 24 hours" },
  { value: "7d", label: "Past week" },
  { value: "30d", label: "Past month" },
];

export const WORK_LOCATIONS = ["onsite", "hybrid", "remote"];
export const WORK_LABELS = { onsite: "In Person", hybrid: "Hybrid", remote: "Remote" };

export const JOB_TYPES = ["full_time", "part_time", "internship"];
export const JOB_LABELS = {
  full_time: "Full Time",
  part_time: "Part Time",
  internship: "Internship",
};

export const EXPERIENCE_LEVELS = ["entry", "mid", "senior", "executive"];
export const EXPERIENCE_LABELS = {
  entry: "Entry Level",
  mid: "Mid Level",
  senior: "Senior Level",
  executive: "Executive Level",
};

export const DEFAULT_FILTERS = {
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
  searchRadius: DEFAULT_SEARCH_RADIUS,
  onlyMyCountry: false,
};

export function mergeFilters(initial) {
  return { ...DEFAULT_FILTERS, ...(initial || {}) };
}

export function toggleFilterArray(values, value) {
  const list = Array.isArray(values) ? values : [];
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function formatMinSalary(value) {
  const n = Number(value) || 0;
  if (n >= 250000) return "$250k+";
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toLocaleString()}`;
}

export function hasActiveFilters(value, defaultRadius = DEFAULT_SEARCH_RADIUS) {
  if (!value) return false;
  return Boolean(
    value.minSalary > 0
    || (value.postedDate && value.postedDate !== "any")
    || (value.workLocations || []).length
    || (value.jobTypes || []).length
    || (value.experience || []).length
    || (value.locations || []).length
    || (value.locationsData || []).length
    || value.locationData
    || (value.onlyCompanies || []).length
    || (value.hideCompanies || []).length
    || (value.onlyIndustries || []).length
    || (value.hideIndustries || []).length
    || value.includeUnknownLocation === false
    || value.includeUnknownSalary === false
    || (value.searchRadius && value.searchRadius !== defaultRadius)
    || value.onlyMyCountry,
  );
}

export function countActiveFilterGroups(value, defaultRadius = DEFAULT_SEARCH_RADIUS) {
  if (!value) return 0;
  let count = 0;
  if (value.minSalary > 0) count += 1;
  if (value.postedDate && value.postedDate !== "any") count += 1;
  if ((value.workLocations || []).length) count += 1;
  if ((value.jobTypes || []).length) count += 1;
  if ((value.experience || []).length) count += 1;
  if ((value.onlyCompanies || []).length || (value.hideCompanies || []).length) count += 1;
  if ((value.onlyIndustries || []).length || (value.hideIndustries || []).length) count += 1;
  if (value.includeUnknownLocation === false || value.includeUnknownSalary === false) count += 1;
  if (value.searchRadius && value.searchRadius !== defaultRadius) count += 1;
  if (value.onlyMyCountry) count += 1;
  if ((value.locations || []).length || (value.locationsData || []).length || value.locationData) count += 1;
  return count;
}
