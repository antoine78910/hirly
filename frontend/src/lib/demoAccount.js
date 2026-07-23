export const DEMO_CREDITS_MAX = 600;
export const DEMO_CREDITS_CHANGED = "hirly:demo-credits-changed";
export const DEMO_ACCOUNT_CHANGED = "hirly:demo-account-changed";

import {
  resetDemoOnlySettings,
  ensureDemoFinanceFeedDefault,
  setFinanceDemoEligibility,
} from "./demoSettings";
import { mergeDemoCvIntoProfile, hasDemoCvStored, shouldMockCvUpload } from "./demoCvUpload";
import axios from "axios";
import { normalizeApiPath } from "./apiPath";
import {
  buildDemoApplicationFromSwipe,
  buildDemoShowcaseApplication,
} from "./demoApplicationFactory";

let cachedDemoAccount = false;

/** Turn on the Paris finance swipe preview by default for demo accounts. */
export function ensureDemoAccountDefaults() {
  ensureDemoFinanceFeedDefault();
}

export function setDemoAccountFromUser(user, isAdmin = false) {
  const nextDemoAccount = Boolean(user?.demo_account) && !isAdmin && !user?.is_admin;
  cachedDemoAccount = nextDemoAccount;
  setFinanceDemoEligibility(cachedDemoAccount, isAdmin);
  if (cachedDemoAccount) {
    ensureDemoAccountDefaults();
  } else if (!isAdmin) {
    resetDemoOnlySettings();
    clearDemoAccountLocalData();
    if (typeof window !== "undefined") {
      void import("./financeDemoApi").then(({ resetFinanceDemoFeed }) => {
        resetFinanceDemoFeed();
      });
      void import("./demoCvUpload").then(({ clearStoredDemoCv }) => {
        clearStoredDemoCv();
      });
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEMO_ACCOUNT_CHANGED));
  }
}

export function isDemoAccountEnabled() {
  return cachedDemoAccount;
}

const CREDITS_KEY = "hirly.demo.credits.remaining";
const APPS_KEY = "hirly.demo.applications";
const HISTORY_RIGHT_KEY = "hirly.demo.history.right";
const HISTORY_LEFT_KEY = "hirly.demo.history.left";
const UNDO_KEY = "hirly.demo.undo";
const TUTORIAL_PREFS_KEY = "hirly.tutorial.preferences";
const SESSION_TOKEN_KEY = "session_token";

const DEMO_LOCAL_STORAGE_KEYS = [
  CREDITS_KEY,
  APPS_KEY,
  HISTORY_RIGHT_KEY,
  HISTORY_LEFT_KEY,
  UNDO_KEY,
  TUTORIAL_PREFS_KEY,
  "hirly.finance.demo.applications.v1",
  "hirly.finance.demo.history.right.v1",
  "hirly.finance.demo.history.left.v1",
  "hirly.demo.cv.v1",
];

const TUTORIAL_PROFILE_DEFAULT = {
  target_role: "Software Engineer",
  target_roles: ["Software Engineer", "Frontend Engineer"],
  target_location: "Paris, France",
  target_location_data: {
    location_label: "Paris, France",
    country: "France",
    country_code: "FR",
  },
  remote_preference: "hybrid",
  seniority: "mid",
  summary: "Senior software engineer focused on React, TypeScript, and product delivery.",
  skills: ["React", "TypeScript", "Node.js", "Python"],
};

function hasSessionToken() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(SESSION_TOKEN_KEY));
  } catch {
    return false;
  }
}

function shouldMockTutorialProfileRoutes() {
  return isDemoAccountEnabled() && !hasSessionToken();
}

function getTutorialPreferences() {
  return readJson(TUTORIAL_PREFS_KEY, null);
}

function saveTutorialPreferences(payload) {
  writeJson(TUTORIAL_PREFS_KEY, payload);
}

function buildTutorialProfileResponse() {
  const saved = getTutorialPreferences();
  return mergeDemoCvIntoProfile({
    user_id: "tutorial_filming",
    ...TUTORIAL_PROFILE_DEFAULT,
    ...(saved || {}),
  });
}

const jobCache = new Map();

/** Remove cached demo swipes/applications so they never leak into real accounts. */
export function clearDemoAccountLocalData() {
  if (typeof window === "undefined") return;
  for (const key of DEMO_LOCAL_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  jobCache.clear();
}

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
    /* ignore quota errors */
  }
}

export function getDemoCreditsRemaining() {
  const stored = readJson(CREDITS_KEY, null);
  if (stored === null || typeof stored !== "number" || stored <= 0) {
    writeJson(CREDITS_KEY, DEMO_CREDITS_MAX);
    return DEMO_CREDITS_MAX;
  }
  return stored;
}

export function consumeDemoCredit() {
  let remaining = getDemoCreditsRemaining();
  remaining -= 1;
  if (remaining <= 0) remaining = DEMO_CREDITS_MAX;
  writeJson(CREDITS_KEY, remaining);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEMO_CREDITS_CHANGED));
  }
  return remaining;
}

export function cacheJobForDemo(job) {
  if (job?.job_id) jobCache.set(job.job_id, job);
}

export function getCachedDemoJob(jobId) {
  return jobCache.get(jobId);
}

function resolveJob(jobId) {
  return (
    jobCache.get(jobId) || {
      job_id: jobId,
      title: "Role",
      company: "Company",
      location: "",
    }
  );
}

export function buildDemoApplication(job, variantIndex = 0) {
  return buildDemoShowcaseApplication(job, variantIndex);
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function seedTutorialShowcaseIfEmpty(jobs = []) {
  if (!isDemoAccountEnabled()) return;
  if (getDemoApplications().length > 0) return;

  const picks = (jobs || []).filter((job) => job?.job_id).slice(0, 3);
  if (!picks.length) return;

  picks.forEach((job) => {
    cacheJobForDemo(job);
  });

  const applications = picks.map((job, index) => ({
    ...buildDemoApplication(job, index),
    created_at: daysAgoIso(index + 1),
  }));

  writeJson(APPS_KEY, applications);
  writeJson(
    HISTORY_RIGHT_KEY,
    picks.map((job, index) => ({
      ...buildSwipeRow(job, "right"),
      created_at: daysAgoIso(index + 1),
    })),
  );
}

export function seedDemoShowcaseIfEmpty() {
  if (!isDemoAccountEnabled()) return;
  if (getDemoApplications().length > 0) return;

  const TECH_SHOWCASE_JOBS = [
    {
      job_id: "demo_showcase_linear",
      title: "Senior Frontend Engineer",
      company: "Linear",
      location: "Paris, France",
      match_score: 92,
      provider: "demo",
    },
    {
      job_id: "demo_showcase_stripe",
      title: "Backend Engineer",
      company: "Stripe",
      location: "Paris, France",
      match_score: 89,
      provider: "demo",
    },
    {
      job_id: "demo_showcase_vercel",
      title: "DevRel Engineer",
      company: "Vercel",
      location: "Remote, France",
      match_score: 87,
      provider: "demo",
    },
    {
      job_id: "demo_showcase_notion",
      title: "Staff Engineer",
      company: "Notion",
      location: "Paris, France",
      match_score: 94,
      provider: "demo",
    },
    {
      job_id: "demo_showcase_figma",
      title: "Product Engineer",
      company: "Figma",
      location: "Paris, France",
      match_score: 90,
      provider: "demo",
    },
  ];

  const jobs = TECH_SHOWCASE_JOBS;
  jobs.forEach((job) => {
    cacheJobForDemo(job);
  });

  const applications = jobs.map((job, index) => ({
    ...buildDemoApplication(job, index),
    application_id: `demo_showcase_${job.job_id}`,
    created_at: daysAgoIso(index + 1),
    submitted_at: index <= 3 ? daysAgoIso(index + 1) : undefined,
  }));

  writeJson(APPS_KEY, applications);
  writeJson(
    HISTORY_RIGHT_KEY,
    jobs.map((job, index) => ({
      swipe_id: `demo_showcase_swipe_${job.job_id}`,
      job_id: job.job_id,
      job: { ...job },
      direction: "right",
      match_score: job.match_score,
      created_at: daysAgoIso(index + 1),
    })),
  );
}

function buildSwipeRow(job, direction) {
  return {
    swipe_id: `demo_local_swipe_${Date.now()}_${job.job_id}`,
    job_id: job.job_id,
    job: { ...job },
    direction,
    match_score: job.match_score,
    created_at: new Date().toISOString(),
  };
}

export function getDemoApplications() {
  return readJson(APPS_KEY, []);
}

export function getDemoSwipeHistory(direction) {
  const key = direction === "left" ? HISTORY_LEFT_KEY : HISTORY_RIGHT_KEY;
  return readJson(key, []);
}

function mergeByJobId(localRows, apiRows) {
  const seen = new Set();
  const merged = [];
  for (const row of [...localRows, ...(apiRows || [])]) {
    const id = row?.job_id || row?.application_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  return merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export function mergeApplications(apiApplications) {
  return mergeByJobId(getDemoApplications(), apiApplications);
}

export function mergeSwipeHistory(apiSwipes, direction) {
  const local = getDemoSwipeHistory(direction);
  return mergeByJobId(local, apiSwipes);
}

export function handleDemoAccountSwipe(body = {}) {
  const { job_id: jobId, direction } = body;
  const job = resolveJob(jobId);
  const undoStack = readJson(UNDO_KEY, []);

  if (direction === "right") {
    consumeDemoCredit();
    const application = buildDemoApplicationFromSwipe(job);
    writeJson(APPS_KEY, [application, ...getDemoApplications()]);

    const row = buildSwipeRow(job, "right");
    writeJson(HISTORY_RIGHT_KEY, [row, ...getDemoSwipeHistory("right")]);

    undoStack.push({ job: { ...job }, direction, application_id: application.application_id });
    writeJson(UNDO_KEY, undoStack);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(DEMO_ACCOUNT_CHANGED));
    }

    return {
      ok: true,
      applied: true,
      application_id: application.application_id,
      demo_local: true,
    };
  }

  const row = buildSwipeRow(job, "left");
  writeJson(HISTORY_LEFT_KEY, [row, ...getDemoSwipeHistory("left")]);
  undoStack.push({ job: { ...job }, direction });
  writeJson(UNDO_KEY, undoStack);

  return { ok: true, applied: false, demo_local: true };
}

export function handleDemoAccountUndo() {
  const undoStack = readJson(UNDO_KEY, []);
  const last = undoStack.pop();
  if (!last) return { ok: false };

  writeJson(UNDO_KEY, undoStack);

  if (last.direction === "right") {
    writeJson(
      APPS_KEY,
      getDemoApplications().filter(
        (a) => a.application_id !== last.application_id && a.job_id !== last.job?.job_id,
      ),
    );
    writeJson(
      HISTORY_RIGHT_KEY,
      getDemoSwipeHistory("right").filter((r) => r.job_id !== last.job?.job_id),
    );
  } else {
    writeJson(
      HISTORY_LEFT_KEY,
      getDemoSwipeHistory("left").filter((r) => r.job_id !== last.job?.job_id),
    );
  }

  return { ok: true };
}

function removeDemoSwipe(jobId) {
  writeJson(
    HISTORY_RIGHT_KEY,
    getDemoSwipeHistory("right").filter((r) => r.job_id !== jobId),
  );
  writeJson(
    HISTORY_LEFT_KEY,
    getDemoSwipeHistory("left").filter((r) => r.job_id !== jobId),
  );
  writeJson(
    APPS_KEY,
    getDemoApplications().filter((a) => a.job_id !== jobId),
  );
}

export function findDemoApplication(applicationId) {
  return getDemoApplications().find((a) => a.application_id === applicationId);
}

/** Mock only apply-related routes; feed/profile still use the real API unless full demoMode. */
export function getDemoAccountResponse(config) {
  if (!isDemoAccountEnabled()) return undefined;

  const method = (config.method || "get").toLowerCase();
  const path = normalizeApiPath(axios.getUri(config));
  const body = config.data;

  if (method === "put" && path === "/profile/preferences") {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    saveTutorialPreferences({
      target_role: parsed?.target_role,
      target_roles: parsed?.target_roles,
      target_location: parsed?.target_location,
      target_location_data: parsed?.target_location_data,
      remote_preference: parsed?.remote_preference,
    });
    if (shouldMockTutorialProfileRoutes()) {
      return buildTutorialProfileResponse();
    }
    return undefined;
  }

  if (method === "get" && path === "/profile") {
    if (shouldMockTutorialProfileRoutes()) {
      return buildTutorialProfileResponse();
    }
    return undefined;
  }

  if (method === "post" && path === "/swipe") {
    if (isDemoAccountEnabled()) {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      return handleDemoAccountSwipe(parsed);
    }
    return undefined;
  }

  if (method === "post" && path === "/swipe/undo") {
    return handleDemoAccountUndo();
  }

  if (method === "post" && /^\/swipes\/[^/]+\/apply-from-passed$/.test(path)) {
    const jobId = path.split("/")[2];
    removeDemoSwipe(jobId);
    return handleDemoAccountSwipe({ job_id: jobId, direction: "right" });
  }

  if (method === "delete" && path.startsWith("/swipes/")) {
    const jobId = path.replace("/swipes/", "");
    removeDemoSwipe(jobId);
    return { ok: true };
  }

  if (method === "get" && path.startsWith("/applications/")) {
    const id = path.replace("/applications/", "");
    const app = findDemoApplication(id);
    if (app) return app;
    return undefined;
  }

  if (method === "get" && path === "/emails") {
    const { buildDemoInboxPayload } = require("./demoEmails");
    return buildDemoInboxPayload();
  }

  return undefined;
}

export function patchDemoAccountResponse(response) {
  if (!isDemoAccountEnabled()) return response;

  const method = (response.config?.method || "get").toLowerCase();
  const requestUrl = axios.getUri(response.config || {});
  const path = normalizeApiPath(requestUrl);

  if (method === "get" && path === "/applications") {
    response.data = {
      ...response.data,
      applications: mergeApplications(response.data?.applications || []),
    };
  }

  if (method === "get" && path === "/swipes/history") {
    const direction =
      new URLSearchParams(requestUrl.split("?")[1] || "").get("direction") === "left"
        ? "left"
        : "right";
    response.data = {
      ...response.data,
      swipes: mergeSwipeHistory(response.data?.swipes || [], direction),
    };
  }

  if (method === "get" && path.startsWith("/applications/")) {
    const id = path.replace("/applications/", "");
    const local = findDemoApplication(id);
    if (local) response.data = local;
  }

  if (method === "get" && path === "/profile") {
    if (shouldMockCvUpload() && hasDemoCvStored()) {
      response.data = mergeDemoCvIntoProfile(response.data || {});
    } else if (shouldMockTutorialProfileRoutes()) {
      const local = buildTutorialProfileResponse();
      response.data = { ...(response.data || {}), ...local };
    }
  }

  if (method === "get" && path === "/emails") {
    const { buildDemoInboxPayload } = require("./demoEmails");
    response.data = buildDemoInboxPayload();
  }

  return response;
}

export function getDemoAccountSearchTarget() {
  return {
    role: TUTORIAL_PROFILE_DEFAULT.target_role,
    location: TUTORIAL_PROFILE_DEFAULT.target_location,
    locationData: TUTORIAL_PROFILE_DEFAULT.target_location_data,
  };
}
