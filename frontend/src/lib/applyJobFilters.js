import { mergeFilters } from "./jobFilters";
import { JOB_TYPE_ALIASES } from "./contractTypeMapping";

const POSTED_DAYS = { "1d": 1, "7d": 7, "30d": 30 };

const EXPERIENCE_ALIASES = {
  entry: ["junior", "entry"],
  mid: ["mid", "intermediate"],
  senior: ["senior"],
  executive: ["lead", "principal", "executive", "director"],
};

function jobWorkLocation(job) {
  const raw = job.remote;
  if (typeof raw === "boolean") return raw ? "remote" : "onsite";
  const text = [raw, job.location, job.workplace_type, job.work_location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("remote") || text.includes("work from home")) return "remote";
  if (
    text.includes("onsite") ||
    text.includes("on-site") ||
    text.includes("in person") ||
    text.includes("office")
  ) {
    return "onsite";
  }
  return "unknown";
}

function matchesWorkLocation(job, filters) {
  const wanted = filters.workLocations || [];
  if (!wanted.length) return true;
  const actual = jobWorkLocation(job);
  if (actual === "unknown") return filters.includeUnknownLocation !== false;
  return wanted.some((item) => {
    const key = String(item).toLowerCase();
    const normalized =
      key === "in-person" || key === "in_person" || key === "on-site" ? "onsite" : key;
    return normalized === actual;
  });
}

function matchesSalary(job, filters) {
  const minSalary = Number(filters.minSalary || 0);
  if (!minSalary) return true;
  const salaryMax = job.salary_max;
  if (salaryMax == null || salaryMax === "") {
    return filters.includeUnknownSalary !== false;
  }
  return Number(salaryMax) >= minSalary;
}

function matchesPostedDate(job, filters) {
  const postedWithin = filters.postedDate;
  if (!postedWithin || postedWithin === "any") return true;
  const days = POSTED_DAYS[postedWithin];
  if (!days) return true;
  const raw = job.posted_at || job.imported_at || job.last_seen_at;
  if (!raw) return false;
  const posted = new Date(raw);
  if (Number.isNaN(posted.getTime())) return false;
  const cutoff = Date.now() - days * 86_400_000;
  return posted.getTime() >= cutoff;
}

function matchesJobType(job, filters) {
  const wanted = filters.jobTypes || [];
  if (!wanted.length) return true;
  const kind = String(job.employment_kind || "").toLowerCase();
  if (kind && wanted.includes(kind)) return true;
  const text = [job.job_type, job.employment_type, job.contract_type, job.title, job.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return wanted.some((kind) => {
    const aliases = JOB_TYPE_ALIASES[kind] || [kind];
    return aliases.some((alias) => text.includes(alias));
  });
}

function matchesExperience(job, filters) {
  const wantedLevels = filters.experience || [];
  if (!wantedLevels.length) return true;
  const needles = wantedLevels.flatMap((item) => EXPERIENCE_ALIASES[item] || [item]);
  const seniority = String(job.seniority || "").toLowerCase();
  const title = String(job.title || "").toLowerCase();
  return needles.some((item) => seniority.includes(item) || title.includes(item));
}

function matchesCompany(job, filters) {
  const company = String(job.company || "").toLowerCase();
  const onlyCompanies = filters.onlyCompanies || [];
  const hideCompanies = filters.hideCompanies || [];
  if (
    onlyCompanies.length &&
    !onlyCompanies.some((item) => company === String(item).toLowerCase())
  ) {
    return false;
  }
  if (hideCompanies.some((item) => company.includes(String(item).toLowerCase()))) {
    return false;
  }
  return true;
}

function matchesIndustry(job, filters) {
  const onlyIndustries = filters.onlyIndustries || [];
  const hideIndustries = filters.hideIndustries || [];
  if (!onlyIndustries.length && !hideIndustries.length) return true;
  const text = [
    job.industry,
    ...(Array.isArray(job.industries) ? job.industries : []),
    job.company,
    job.description,
    job.clean_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    onlyIndustries.length &&
    !onlyIndustries.some((item) => text.includes(String(item).toLowerCase()))
  ) {
    return false;
  }
  if (hideIndustries.some((item) => text.includes(String(item).toLowerCase()))) {
    return false;
  }
  return true;
}

function selectedLocations(filters) {
  if (filters.locationsData?.length) return filters.locationsData;
  if (filters.locationData) return [filters.locationData];
  return [];
}

function matchesLocation(job, filters, profileLocationData) {
  const locationsData = selectedLocations(filters);
  const locationLabels = filters.locations || [];
  const onlyMyCountry = Boolean(filters.onlyMyCountry);

  if (!locationsData.length && !locationLabels.length && !onlyMyCountry) return true;

  const jobLocation = String(job.location || "").toLowerCase();
  const jobCountryCode = String(job.country_code || "")
    .toLowerCase()
    .trim();
  if (!jobLocation && !jobCountryCode) {
    return filters.includeUnknownLocation !== false;
  }

  const cityMatch = (term) => term && jobLocation.includes(String(term).toLowerCase());
  const countryMatch = (term) => term && jobLocation.includes(String(term).toLowerCase());

  if (locationsData.length) {
    const matched = locationsData.some((loc) => {
      const label = String(loc.location_label || "").toLowerCase();
      const city = label.split(",")[0]?.trim();
      const country = String(loc.country || "").toLowerCase();
      const code = String(loc.country_code || "").toLowerCase();
      return cityMatch(city) || countryMatch(country) || (code && jobCountryCode === code);
    });
    if (matched) return true;
  }

  if (locationLabels.length) {
    const matched = locationLabels.some((label) => {
      const city = String(label).split(",")[0]?.trim();
      return cityMatch(city) || countryMatch(String(label).toLowerCase());
    });
    if (matched) return true;
  }

  if (onlyMyCountry && profileLocationData) {
    const profileCode = String(profileLocationData.country_code || "")
      .toLowerCase()
      .trim();
    const profileCountry = String(profileLocationData.country || "")
      .toLowerCase()
      .trim();
    if (profileCode && jobCountryCode === profileCode) return true;
    if (profileCountry && jobLocation.includes(profileCountry)) return true;
    return false;
  }

  return false;
}

function matchesSearchRole(job, searchRole) {
  const query = String(searchRole || "")
    .trim()
    .toLowerCase();
  if (!query) return true;
  const haystack = [job.title, job.company, job.description, job.clean_description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/** Client-side feed filtering (finance demo + local mocks). Mirrors backend /jobs/feed filters. */
export function applyJobFilters(jobs, rawFilters, { searchRole, profileLocationData } = {}) {
  const filters = mergeFilters(rawFilters);
  return (jobs || []).filter(
    (job) =>
      matchesSearchRole(job, searchRole) &&
      matchesWorkLocation(job, filters) &&
      matchesSalary(job, filters) &&
      matchesPostedDate(job, filters) &&
      matchesJobType(job, filters) &&
      matchesExperience(job, filters) &&
      matchesCompany(job, filters) &&
      matchesIndustry(job, filters) &&
      matchesLocation(job, filters, profileLocationData),
  );
}

/** Build a filters object from /jobs/feed query params (supports repeated keys). */
export function feedQueryToFilters(params) {
  const search =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(typeof params === "string" ? params : "");

  const num = (key) => {
    const value = Number(search.get(key));
    return Number.isFinite(value) ? value : 0;
  };

  const bool = (key, defaultValue = true) => {
    const value = search.get(key);
    if (value == null) return defaultValue;
    return value !== "false";
  };

  let locationsData = [];
  const locationsJson = search.get("locations_json");
  if (locationsJson) {
    try {
      const parsed = JSON.parse(locationsJson);
      if (Array.isArray(parsed)) locationsData = parsed;
    } catch {
      /* ignore */
    }
  }

  return mergeFilters({
    minSalary: num("min_salary"),
    postedDate: search.get("posted_within") || "any",
    workLocations: search.getAll("work_location"),
    jobTypes: search.getAll("job_type"),
    experience: search.getAll("experience"),
    locations: search.getAll("location"),
    locationsData,
    onlyCompanies: search.getAll("only_company"),
    hideCompanies: search.getAll("hide_company"),
    onlyIndustries: search.getAll("only_industry"),
    hideIndustries: search.getAll("hide_industry"),
    includeUnknownLocation: bool("include_unknown_location", true),
    includeUnknownSalary: bool("include_unknown_salary", true),
    searchRadius: search.get("search_radius") || undefined,
    onlyMyCountry: search.get("only_my_country") === "true",
  });
}
