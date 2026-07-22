import { mergeFilters } from "./jobFilters";

const STORAGE_KEY = "swiipr.swipe.feed.v1";
const SWIPED_IDS_STORAGE_KEY = "swiipr.swipe.swiped.v1";
const MAX_JOBS = 24;
/** Skip network refresh on return navigation when cache is newer than this. */
export const SWIPE_FEED_CACHE_FRESH_MS = 5 * 60 * 1000;
/** Drop session cache after this even if the tab stays open. */
const SWIPE_FEED_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const memory = {
  jobs: null,
  meta: null,
  target: null,
  targetLocationData: null,
  filters: null,
  cacheKey: null,
  savedAt: 0,
  userId: null,
  swipedJobIds: new Set(),
  swipedUserId: null,
};

const stableStringify = (value) => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
};

export function buildSwipeFeedCacheKey({ userId, target, targetLocationData, filters }) {
  const merged = mergeFilters(filters || {});
  return stableStringify({
    userId: userId || "",
    role: (target?.role || "").trim(),
    location: (target?.location || "").trim(),
    locationData: targetLocationData || null,
    filters: {
      minSalary: merged.minSalary || null,
      postedDate: merged.postedDate || "any",
      workLocations: merged.workLocations || [],
      jobTypes: merged.jobTypes || [],
      experience: merged.experience || [],
      locations: merged.locations || [],
      locationsData: merged.locationsData || [],
      locationData: merged.locationData || null,
      onlyCompanies: merged.onlyCompanies || [],
      hideCompanies: merged.hideCompanies || [],
      onlyIndustries: merged.onlyIndustries || [],
      hideIndustries: merged.hideIndustries || [],
      includeUnknownLocation: merged.includeUnknownLocation !== false,
      includeUnknownSalary: merged.includeUnknownSalary !== false,
      searchRadius: merged.searchRadius || null,
      onlyMyCountry: Boolean(merged.onlyMyCountry),
    },
  });
}

function readSwipedIdsPayload() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SWIPED_IDS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.jobIds)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeSwipedIdsPayload() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SWIPED_IDS_STORAGE_KEY,
      JSON.stringify({
        userId: memory.swipedUserId || null,
        jobIds: Array.from(memory.swipedJobIds || []),
      }),
    );
  } catch (_) {
    try {
      window.sessionStorage.removeItem(SWIPED_IDS_STORAGE_KEY);
    } catch (_) {}
  }
}

function hydrateSwipedIdsFromSession() {
  const stored = readSwipedIdsPayload();
  if (!stored) return;
  if (memory.swipedJobIds?.size) return;
  memory.swipedJobIds = new Set(stored.jobIds.filter(Boolean));
  memory.swipedUserId = stored.userId || null;
}

function resetSwipedIdsForUser(userId) {
  memory.swipedJobIds = new Set();
  memory.swipedUserId = userId || null;
  writeSwipedIdsPayload();
}

export function getSwipedJobIds() {
  hydrateSwipedIdsFromSession();
  return new Set(memory.swipedJobIds || []);
}

export function recordSwipedJobId(jobId, userId) {
  if (!jobId) return;
  hydrateSwipedIdsFromSession();
  if (userId && memory.swipedUserId && memory.swipedUserId !== userId) {
    resetSwipedIdsForUser(userId);
  } else if (userId && !memory.swipedUserId) {
    memory.swipedUserId = userId;
  }
  memory.swipedJobIds.add(jobId);
  writeSwipedIdsPayload();
}

export function unrecordSwipedJobId(jobId) {
  if (!jobId) return;
  hydrateSwipedIdsFromSession();
  if (!memory.swipedJobIds.delete(jobId)) return;
  writeSwipedIdsPayload();
}

export function clearSwipedJobIdsByPrefix(prefix) {
  const needle = String(prefix || "");
  if (!needle) return;
  hydrateSwipedIdsFromSession();
  if (!memory.swipedJobIds?.size) return;
  let changed = false;
  for (const id of [...memory.swipedJobIds]) {
    if (String(id).startsWith(needle)) {
      memory.swipedJobIds.delete(id);
      changed = true;
    }
  }
  if (changed) writeSwipedIdsPayload();
}

export function seedSwipedJobIds(jobIds, userId) {
  if (!Array.isArray(jobIds) || !jobIds.length) return;
  hydrateSwipedIdsFromSession();
  if (userId && memory.swipedUserId && memory.swipedUserId !== userId) {
    resetSwipedIdsForUser(userId);
  } else if (userId) {
    memory.swipedUserId = userId;
  }
  let changed = false;
  jobIds.forEach((jobId) => {
    if (!jobId) return;
    if (!memory.swipedJobIds.has(jobId)) {
      memory.swipedJobIds.add(jobId);
      changed = true;
    }
  });
  if (changed) writeSwipedIdsPayload();
}

export function filterOutSwipedJobs(jobs) {
  if (!Array.isArray(jobs) || !jobs.length) return [];
  hydrateSwipedIdsFromSession();
  if (!memory.swipedJobIds?.size) return jobs;
  return jobs.filter((job) => job?.job_id && !memory.swipedJobIds.has(job.job_id));
}

function readSessionPayload() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.jobs) || !parsed.jobs.length) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > SWIPE_FEED_CACHE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeSessionPayload(payload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }
}

function hydrateMemoryFromSession() {
  if (memory.jobs?.length) return memory;
  const stored = readSessionPayload();
  if (!stored) return memory;
  memory.jobs = stored.jobs;
  memory.meta = stored.meta || null;
  memory.target = stored.target || null;
  memory.targetLocationData = stored.targetLocationData ?? null;
  memory.filters = stored.filters || null;
  memory.cacheKey = stored.cacheKey || null;
  memory.savedAt = stored.savedAt || 0;
  memory.userId = stored.userId || null;
  return memory;
}

export function readSwipeFeedCache({ userId, cacheKey } = {}) {
  hydrateMemoryFromSession();
  hydrateSwipedIdsFromSession();
  if (userId && memory.swipedUserId && memory.swipedUserId !== userId) {
    resetSwipedIdsForUser(userId);
  }
  if (!memory.jobs?.length) return null;
  if (userId && memory.userId && memory.userId !== userId) return null;
  if (cacheKey && memory.cacheKey && memory.cacheKey !== cacheKey) return null;
  const jobs = filterOutSwipedJobs(memory.jobs);
  if (!jobs.length) return null;
  return {
    jobs,
    meta: memory.meta,
    target: memory.target,
    targetLocationData: memory.targetLocationData,
    filters: memory.filters,
    cacheKey: memory.cacheKey,
    savedAt: memory.savedAt,
    userId: memory.userId,
  };
}

export function isSwipeFeedCacheFresh(savedAt = memory.savedAt) {
  return Boolean(savedAt) && Date.now() - savedAt < SWIPE_FEED_CACHE_FRESH_MS;
}

export function writeSwipeFeedCache({
  jobs,
  meta,
  target,
  targetLocationData,
  filters,
  cacheKey,
  userId,
}) {
  const visibleJobs = filterOutSwipedJobs(jobs);
  if (!Array.isArray(visibleJobs) || !visibleJobs.length) return;
  const trimmedJobs = visibleJobs.slice(0, MAX_JOBS);
  const savedAt = Date.now();
  memory.jobs = trimmedJobs;
  memory.meta = meta || null;
  memory.target = target || null;
  memory.targetLocationData = targetLocationData ?? null;
  memory.filters = filters || null;
  memory.cacheKey = cacheKey || null;
  memory.savedAt = savedAt;
  memory.userId = userId || null;
  writeSessionPayload({
    jobs: trimmedJobs,
    meta: memory.meta,
    target: memory.target,
    targetLocationData: memory.targetLocationData,
    filters: memory.filters,
    cacheKey: memory.cacheKey,
    savedAt,
    userId: memory.userId,
  });
}

export function clearSwipeFeedCache() {
  memory.jobs = null;
  memory.meta = null;
  memory.target = null;
  memory.targetLocationData = null;
  memory.filters = null;
  memory.cacheKey = null;
  memory.savedAt = 0;
  memory.userId = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }
}

/** Snapshot for synchronous React state init on mount. */
export function getSwipeFeedCacheSnapshot() {
  hydrateMemoryFromSession();
  hydrateSwipedIdsFromSession();
  if (!memory.jobs?.length) {
    return {
      jobs: [],
      meta: null,
      target: null,
      targetLocationData: null,
      filters: null,
      savedAt: 0,
    };
  }
  return {
    jobs: filterOutSwipedJobs(memory.jobs),
    meta: memory.meta,
    target: memory.target,
    targetLocationData: memory.targetLocationData,
    filters: memory.filters,
    savedAt: memory.savedAt,
  };
}
