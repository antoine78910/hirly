import {
  FINANCE_DEMO_JOBS,
  FINANCE_DEMO_PROFILE,
  demoFinanceSwipeRow,
} from "./financeDemoJobs";
import { isFinanceDemoEnabled } from "./demoSettings";
import { consumeDemoCredit } from "./demoAccount";

const state = {
  feedJobs: FINANCE_DEMO_JOBS.map((j) => ({ ...j })),
  applications: [],
  historyRight: [],
  historyLeft: [],
  undoStack: [],
};

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function parsePath(url = "") {
  const [path, query = ""] = url.split("?");
  const params = Object.fromEntries(new URLSearchParams(query));
  return { path, params };
}

export function resetFinanceDemoFeed() {
  state.feedJobs = FINANCE_DEMO_JOBS.map((j) => ({ ...j }));
  state.applications = [];
  state.historyRight = [];
  state.historyLeft = [];
  state.undoStack = [];
}

function findJob(jobId) {
  return (
    state.feedJobs.find((j) => j.job_id === jobId)
    || state.applications.find((a) => a.job_id === jobId)?.job
    || [...state.historyRight, ...state.historyLeft].find((r) => r.job_id === jobId)?.job
    || FINANCE_DEMO_JOBS.find((j) => j.job_id === jobId)
  );
}

function handleSwipe(body = {}) {
  const { job_id: jobId, direction } = body;
  const job = findJob(jobId);
  if (!job) return { ok: false };

  state.feedJobs = state.feedJobs.filter((j) => j.job_id !== jobId);
  const row = demoFinanceSwipeRow(job, direction);
  state.undoStack.push({ job: { ...job }, direction, row });

  if (direction === "right") {
    consumeDemoCredit();
    state.historyRight.unshift(row);
    const application = {
      application_id: `finance_demo_app_${Date.now()}`,
      job_id: jobId,
      job: { ...job },
      status: "applied",
      submission_status: "not_submitted",
      package_status: "ready",
      match_score: job.match_score,
      match_reasons: job.match_reasons,
      created_at: new Date().toISOString(),
      tailored_resume: {
        summary: "CV adapté pour une candidature en banque (démo).",
        highlights: ["Expérience finance", "Modélisation financière", "Anglais courant"],
      },
      cover_letter: {
        greeting: `Madame, Monsieur,`,
        body: `Je souhaite vous proposer ma candidature pour le poste de ${job.title} chez ${job.company}.`,
        closing: "Cordialement,\nAlex Martin",
      },
    };
    state.applications.unshift(application);
    return { ok: true, applied: true, application_id: application.application_id, demo_local: true };
  }

  state.historyLeft.unshift(row);
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
  return { ok: true };
}

/** Mock finance demo routes when settings toggle is on. */
export function getFinanceDemoResponse(config) {
  if (!isFinanceDemoEnabled()) return undefined;

  const method = (config.method || "get").toLowerCase();
  const { path, params } = parsePath(config.url || "");
  const body = config.data;

  if (method === "get" && path === "/jobs/feed") {
    const limit = Number(params.limit || 5);
    return {
      jobs: clone(state.feedJobs.slice(0, limit)),
      total: state.feedJobs.length,
      total_count: state.feedJobs.length,
      feed_mode: "finance_demo",
      fallback_reason: null,
      demo_mode: true,
      finance_demo: true,
      matched_location: ["Paris, France"],
      filters_applied: { target_role: FINANCE_DEMO_PROFILE.target_role },
    };
  }

  if (method === "get" && path === "/profile") {
    return clone(FINANCE_DEMO_PROFILE);
  }

  if (method === "put" && path === "/profile/preferences") {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (parsed?.target_role) FINANCE_DEMO_PROFILE.target_role = parsed.target_role;
    if (parsed?.target_roles) FINANCE_DEMO_PROFILE.target_roles = parsed.target_roles;
    if (parsed?.target_location !== undefined) FINANCE_DEMO_PROFILE.target_location = parsed.target_location;
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
    return { applications: clone(state.applications) };
  }

  if (method === "get" && path.startsWith("/applications/")) {
    const id = path.replace("/applications/", "");
    const app = state.applications.find((a) => a.application_id === id);
    if (!app) return undefined;
    return clone(app);
  }

  return undefined;
}
