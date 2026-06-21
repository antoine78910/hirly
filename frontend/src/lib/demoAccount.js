export const DEMO_CREDITS_MAX = 600;
export const DEMO_CREDITS_CHANGED = "hirly:demo-credits-changed";
export const DEMO_ACCOUNT_CHANGED = "hirly:demo-account-changed";

let cachedDemoAccount = false;

export function setDemoAccountFromUser(user) {
  cachedDemoAccount = Boolean(user?.demo_account);
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

const jobCache = new Map();

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

function resolveJob(jobId) {
  return jobCache.get(jobId) || {
    job_id: jobId,
    title: "Role",
    company: "Company",
    location: "",
  };
}

export function buildDemoApplication(job, variantIndex = 0) {
  const variants = [
    {
      status: "interview",
      submission_status: "submitted",
      user_facing_submission_status: "submitted",
      interview_prep: [
        "Walk me through a recent product feature you shipped end-to-end.",
        "How do you balance speed and code quality on a small team?",
        "Tell me about a time you improved application performance.",
      ],
    },
    {
      status: "viewed",
      submission_status: "submitted",
      user_facing_submission_status: "submitted",
    },
    {
      status: "applied",
      submission_status: "ready",
      user_facing_submission_status: "ready",
    },
    {
      status: "applied",
      submission_status: "not_submitted",
      user_facing_submission_status: "pending",
    },
  ];
  const variant = variants[variantIndex % variants.length];

  return {
    application_id: `demo_local_${Date.now()}_${job.job_id}`,
    job_id: job.job_id,
    job: { ...job },
    status: variant.status,
    submission_status: variant.submission_status,
    user_facing_submission_status: variant.user_facing_submission_status,
    demo_local: true,
    match_score: job.match_score,
    match_reasons: job.match_reasons || [],
    created_at: new Date().toISOString(),
    interview_prep: variant.interview_prep || [],
    tailored_resume: {
      summary: "Tailored CV generated in demo mode (not submitted to employers).",
      highlights: ["Relevant experience highlighted", "Keywords matched to the job description"],
    },
    cover_letter: {
      greeting: `Hi ${job.company} team,`,
      body: `I'm excited about the ${job.title} role at ${job.company}. My background in ${(job.tech_stack || ["React", "TypeScript"]).slice(0, 2).join(" and ")} aligns well with what you're building.`,
      closing: "Best regards,\nAlex Martin",
    },
  };
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function seedTutorialShowcaseIfEmpty(jobs = []) {
  if (!isDemoAccountEnabled()) return;
  if (getDemoApplications().length > 0) return;

  const picks = (jobs || []).filter((job) => job?.job_id).slice(0, 3);
  if (!picks.length) return;

  picks.forEach((job) => cacheJobForDemo(job));

  const applications = picks.map((job, index) => ({
    ...buildDemoApplication(job, index),
    created_at: daysAgoIso(index + 1),
  }));

  writeJson(APPS_KEY, applications);

  const rightSwipes = picks.map((job, index) => ({
    ...buildSwipeRow(job, "right"),
    created_at: daysAgoIso(index + 1),
  }));
  writeJson(HISTORY_RIGHT_KEY, rightSwipes);
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
    const application = buildDemoApplication(job, getDemoApplications().length);
    writeJson(APPS_KEY, [application, ...getDemoApplications()]);

    const row = buildSwipeRow(job, "right");
    writeJson(HISTORY_RIGHT_KEY, [row, ...getDemoSwipeHistory("right")]);

    undoStack.push({ job: { ...job }, direction, application_id: application.application_id });
    writeJson(UNDO_KEY, undoStack);

    return { ok: true, applied: true, application_id: application.application_id, demo_local: true };
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
  const path = (config.url || "").split("?")[0];
  const body = config.data;

  if (method === "post" && path === "/swipe") {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    return handleDemoAccountSwipe(parsed);
  }

  if (method === "post" && path === "/swipe/undo") {
    return handleDemoAccountUndo();
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

  return undefined;
}

export function patchDemoAccountResponse(response) {
  if (!isDemoAccountEnabled()) return response;

  const method = (response.config?.method || "get").toLowerCase();
  const path = (response.config?.url || "").split("?")[0];

  if (method === "get" && path === "/applications") {
    response.data = {
      ...response.data,
      applications: mergeApplications(response.data?.applications || []),
    };
  }

  if (method === "get" && path === "/swipes/history") {
    const direction = new URLSearchParams((response.config?.url || "").split("?")[1] || "").get("direction") === "left"
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

  return response;
}
