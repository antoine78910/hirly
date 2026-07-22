import { FINANCE_DEMO_JOBS, FINANCE_DEMO_PROFILE, demoFinanceSwipeRow } from "./financeDemoJobs";
import axios from "axios";
import { isFinanceDemoEnabled } from "./demoSettings";
import { mergeDemoCvIntoProfile } from "./demoCvUpload";
import { consumeDemoCredit, getCachedDemoJob } from "./demoAccount";
import { parseApiPath } from "./apiPath";
import { applyJobFilters, feedQueryToFilters } from "./applyJobFilters";
import { clearMenuFilters, mergeFilters } from "./jobFilters";
import { clearSwipeFeedCache, clearSwipedJobIdsByPrefix } from "./swipeFeedCache";
import {
  buildDemoApplicationFromSwipe,
  buildDemoShowcaseApplication,
} from "./demoApplicationFactory";
import { buildDemoInboxPayload } from "./demoEmails";
import { ensureDemoScreenshotData } from "./demoScreenshotSeed";

export const FINANCE_DEMO_CHANGED = "hirly:finance-demo-changed";

const FINANCE_APPS_KEY = "hirly.finance.demo.applications.v1";
const FINANCE_HISTORY_RIGHT_KEY = "hirly.finance.demo.history.right.v1";
const FINANCE_HISTORY_LEFT_KEY = "hirly.finance.demo.history.left.v1";

function readJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

function clearFinancePersistence() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FINANCE_APPS_KEY);
    window.localStorage.removeItem(FINANCE_HISTORY_RIGHT_KEY);
    window.localStorage.removeItem(FINANCE_HISTORY_LEFT_KEY);
  } catch {
    /* ignore */
  }
}

function persistFinanceDemoState() {
  writeJson(FINANCE_APPS_KEY, state.applications);
  writeJson(FINANCE_HISTORY_RIGHT_KEY, state.historyRight);
  writeJson(FINANCE_HISTORY_LEFT_KEY, state.historyLeft);
}

function notifyFinanceDemoChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FINANCE_DEMO_CHANGED));
}

const state = {
  feedJobs: FINANCE_DEMO_JOBS.map((j) => ({ ...j })),
  applications: readJson(FINANCE_APPS_KEY, []),
  historyRight: readJson(FINANCE_HISTORY_RIGHT_KEY, []),
  historyLeft: readJson(FINANCE_HISTORY_LEFT_KEY, []),
  undoStack: [],
};

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function getSwipedJobIds() {
  return new Set([
    ...state.historyRight.map((r) => r.job_id),
    ...state.historyLeft.map((r) => r.job_id),
  ]);
}

/** Spread jobs so consecutive cards prefer different companies. */
function interleaveByCompany(jobs) {
  const buckets = new Map();
  for (const job of jobs) {
    const key = job.company || "unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(job);
  }
  const lists = [...buckets.values()];
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of lists) {
      if (list.length) {
        out.push(list.shift());
        added = true;
      }
    }
  }
  return out;
}

function replenishFeedJobs() {
  if (state.feedJobs.length > 0) return;
  const swiped = getSwipedJobIds();
  const pool = FINANCE_DEMO_JOBS.filter((j) => !swiped.has(j.job_id));
  if (!pool.length) {
    state.feedJobs = FINANCE_DEMO_JOBS.map((j) => ({ ...j }));
    return;
  }
  state.feedJobs = pool.map((j) => ({ ...j }));
}

/** Build /jobs/feed payload for the finance Paris demo (local, no backend). */
export function getFinanceDemoFeedData({ filters = null, searchRole = "", limit = 5 } = {}) {
  if (!isFinanceDemoEnabled()) return null;
  replenishFeedJobs();
  const mergedFilters = clearMenuFilters(mergeFilters(filters));
  const filtered = applyJobFilters(state.feedJobs, mergedFilters, {
    // Full finance catalog — target role is display-only so filming gets company diversity.
    searchRole: "",
    profileLocationData: FINANCE_DEMO_PROFILE.target_location_data,
  });
  const diversified = interleaveByCompany(filtered);
  const safeLimit = Math.max(1, Number(limit) || 5);
  return {
    jobs: clone(diversified.slice(0, safeLimit)),
    total: diversified.length,
    total_count: diversified.length,
    feed_mode: "finance_demo",
    fallback_reason: diversified.length ? null : "no_jobs_for_filters",
    demo_mode: true,
    finance_demo: true,
    matched_location: ["Paris, France"],
    filters_applied: { ...mergedFilters, explicit_local_intent: true },
  };
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function financeShowcaseJobs() {
  const pick = (needle) =>
    FINANCE_DEMO_JOBS.find((job) => job.company.toLowerCase().includes(needle));
  return [
    pick("société générale") || FINANCE_DEMO_JOBS[3],
    pick("natixis") || FINANCE_DEMO_JOBS[9],
    pick("crédit agricole") || FINANCE_DEMO_JOBS[6],
    pick("bnp paribas") || FINANCE_DEMO_JOBS[0],
    pick("lazard") || FINANCE_DEMO_JOBS[18],
  ];
}

function buildFinanceShowcaseApplication(job, variantIndex) {
  const app = {
    ...buildDemoShowcaseApplication(job, variantIndex),
    application_id: `finance_demo_showcase_${job.job_id}`,
    finance_demo: true,
    demo_local: true,
    created_at: daysAgoIso(variantIndex + 1),
  };

  if (job.company.includes("Crédit Agricole")) {
    return {
      ...app,
      status: "applied",
      submission_status: "action_required",
      user_facing_submission_status: "action_required",
    };
  }

  return app;
}

/** Seed tracker + inbox rows for finance demo when the user has not swiped yet. */
export function seedFinanceDemoShowcaseIfEmpty() {
  if (!isFinanceDemoEnabled()) return;
  if (state.applications.length > 0) return;

  const jobs = financeShowcaseJobs();
  state.applications = jobs.map((job, index) => buildFinanceShowcaseApplication(job, index));
  state.historyRight = jobs.map((job, index) => ({
    ...demoFinanceSwipeRow(job, "right"),
    swipe_id: `finance_demo_showcase_swipe_${job.job_id}`,
    created_at: daysAgoIso(index + 1),
  }));
  persistFinanceDemoState();
  notifyFinanceDemoChanged();
}

export function resetFinanceDemoFeed() {
  state.feedJobs = FINANCE_DEMO_JOBS.map((j) => ({ ...j }));
  state.applications = [];
  state.historyRight = [];
  state.historyLeft = [];
  state.undoStack = [];
  clearFinancePersistence();
  clearSwipedJobIdsByPrefix("finance_demo_");
  clearSwipeFeedCache();
}

export function getFinanceDemoApplications() {
  return clone(state.applications);
}

export function findFinanceDemoApplication(applicationId) {
  return state.applications.find((a) => a.application_id === applicationId);
}

export function getFinanceDemoSwipeHistory(direction) {
  const rows = direction === "left" ? state.historyLeft : state.historyRight;
  return clone(rows);
}

function findJob(jobId) {
  return (
    getCachedDemoJob(jobId) ||
    state.feedJobs.find((j) => j.job_id === jobId) ||
    state.applications.find((a) => a.job_id === jobId)?.job ||
    [...state.historyRight, ...state.historyLeft].find((r) => r.job_id === jobId)?.job ||
    FINANCE_DEMO_JOBS.find((j) => j.job_id === jobId)
  );
}

function handleSwipe(body = {}) {
  const { job_id: jobId, direction } = body;
  let job = findJob(jobId);
  if (!job && jobId) {
    job = {
      job_id: jobId,
      title: "Role",
      company: "Company",
      location: "Paris, France",
      match_score: 88,
      provider: "demo",
    };
  }
  if (!job) return { ok: false, applied: false };

  state.feedJobs = state.feedJobs.filter((j) => j.job_id !== jobId);
  const row = demoFinanceSwipeRow(job, direction);
  state.undoStack.push({ job: { ...job }, direction, row });

  if (direction === "right") {
    consumeDemoCredit();
    state.historyRight.unshift(row);
    const application = {
      ...buildDemoApplicationFromSwipe(job),
      application_id: `finance_demo_app_${Date.now()}_${jobId}`,
      demo_local: true,
      finance_demo: true,
    };
    state.applications.unshift(application);
    persistFinanceDemoState();
    notifyFinanceDemoChanged();
    return {
      ok: true,
      applied: true,
      application_id: application.application_id,
      demo_local: true,
    };
  }

  state.historyLeft.unshift(row);
  persistFinanceDemoState();
  notifyFinanceDemoChanged();
  return { ok: true, applied: false, demo_local: true };
}

function handleUndo() {
  const last = state.undoStack.pop();
  if (!last) return { ok: false };
  state.feedJobs.unshift(last.job);
  if (last.direction === "right") {
    state.historyRight = state.historyRight.filter((r) => r.job_id !== last.job.job_id);
    state.applications = state.applications.filter((a) => a.job_id !== last.job.job_id);
  } else {
    state.historyLeft = state.historyLeft.filter((r) => r.job_id !== last.job.job_id);
  }
  persistFinanceDemoState();
  notifyFinanceDemoChanged();
  return { ok: true };
}

/** Local finance demo swipe — bypasses network. */
export function performFinanceDemoSwipe(body = {}) {
  if (!isFinanceDemoEnabled()) return undefined;
  return handleSwipe(body);
}

export function performFinanceDemoUndo() {
  if (!isFinanceDemoEnabled()) return undefined;
  return handleUndo();
}

/** Mock finance demo routes when settings toggle is on. */
export function getFinanceDemoResponse(config) {
  if (!isFinanceDemoEnabled()) return undefined;

  const method = (config.method || "get").toLowerCase();
  let requestUrl = config.url || "";
  try {
    requestUrl = axios.getUri(config);
  } catch {
    /* use config.url */
  }
  const { path, params } = parseApiPath(requestUrl);
  const body = config.data;

  if (method === "get" && path.includes("/jobs/feed")) {
    const query = requestUrl.includes("?") ? requestUrl.slice(requestUrl.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    return getFinanceDemoFeedData({
      filters: feedQueryToFilters(params),
      searchRole: params.get("search_role") || "",
      limit: params.get("limit") || 5,
    });
  }

  if (method === "get" && path === "/profile") {
    return mergeDemoCvIntoProfile(clone(FINANCE_DEMO_PROFILE));
  }

  if (method === "put" && path === "/profile/preferences") {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (parsed?.target_role) FINANCE_DEMO_PROFILE.target_role = parsed.target_role;
    if (parsed?.target_roles) FINANCE_DEMO_PROFILE.target_roles = parsed.target_roles;
    if (parsed?.target_location !== undefined)
      FINANCE_DEMO_PROFILE.target_location = parsed.target_location;
    if (parsed?.target_location_data !== undefined) {
      FINANCE_DEMO_PROFILE.target_location_data = parsed.target_location_data;
    }
    return { ok: true };
  }

  if (method === "post" && path === "/jobs/report") {
    return { ok: true };
  }

  if (method === "post" && path === "/swipe") {
    return handleSwipe(typeof body === "string" ? JSON.parse(body) : body);
  }

  if (method === "post" && path === "/swipe/undo") {
    return handleUndo();
  }

  if (method === "get" && path === "/swipes/history") {
    const direction = params.direction === "left" ? "left" : "right";
    const rows = direction === "left" ? state.historyLeft : state.historyRight;
    return { swipes: clone(rows) };
  }

  if (method === "get" && path === "/applications") {
    ensureDemoScreenshotData();
    return { applications: clone(state.applications) };
  }

  if (method === "get" && path.startsWith("/applications/")) {
    const id = path.replace("/applications/", "");
    const app = state.applications.find((a) => a.application_id === id);
    if (!app) return undefined;
    return clone(app);
  }

  if (method === "get" && path === "/emails") {
    ensureDemoScreenshotData();
    return buildDemoInboxPayload();
  }

  return undefined;
}

function mergeSwipeRows(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const row of [...primary, ...secondary]) {
    const id = row?.swipe_id || row?.job_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  return merged.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
}

/** Merge finance demo rows into API responses (when mock is skipped). */
export function patchFinanceDemoResponse(response) {
  if (!isFinanceDemoEnabled()) return response;

  const method = (response.config?.method || "get").toLowerCase();
  let requestUrl = "";
  try {
    requestUrl = axios.getUri(response.config || {});
  } catch {
    requestUrl = response.config?.url || "";
  }
  const { path, params } = parseApiPath(requestUrl);

  if (method === "get" && path === "/applications") {
    ensureDemoScreenshotData();
    const apiApps = response.data?.applications || [];
    response.data = {
      ...response.data,
      applications: mergeApplicationRows(getFinanceDemoApplications(), apiApps),
    };
  }

  if (method === "get" && path.startsWith("/applications/")) {
    const id = path.replace("/applications/", "");
    const local = findFinanceDemoApplication(id);
    if (local) response.data = clone(local);
  }

  if (method === "get" && path.includes("/swipes/history")) {
    const direction = params.direction === "left" ? "left" : "right";
    const local = getFinanceDemoSwipeHistory(direction);
    response.data = {
      ...response.data,
      swipes: mergeSwipeRows(local, response.data?.swipes || []),
    };
  }

  if (method === "get" && path === "/emails") {
    ensureDemoScreenshotData();
    response.data = buildDemoInboxPayload();
  }

  return response;
}

function mergeApplicationRows(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const row of [...primary, ...secondary]) {
    const id = row?.application_id || row?.job_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  return merged.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
}
