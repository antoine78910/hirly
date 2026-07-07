import {
  DEMO_JOBS,
  DEMO_PROFILE,
  DEMO_APPLICATIONS,
  DEMO_INTERVIEW_PREP,
  DEMO_STREAK,
  DEMO_IMPROVE,
  DEMO_INTERVIEW_SCORE,
  DEMO_HISTORY_RIGHT,
  DEMO_HISTORY_LEFT,
  demoSwipeRow,
} from "./demoData";
import { getDemoTrainingCatalog, getDemoTrainingCourseDetail } from "./demoTrainingData";
import { getInviteDevResponse } from "./inviteDevMocks";
import { isDemoAccountEnabled, consumeDemoCredit } from "./demoAccount";
import { mergeDemoCvIntoProfile } from "./demoCvUpload";
import axios from "axios";
import { parseApiPath } from "./apiPath";
import { applyJobFilters, feedQueryToFilters } from "./applyJobFilters";

const state = {
  feedJobs: DEMO_JOBS.map((j) => ({ ...j })),
  applications: DEMO_APPLICATIONS.map((a) => ({ ...a, job: { ...a.job } })),
  historyRight: DEMO_HISTORY_RIGHT.map((r) => ({ ...r, job: { ...r.job } })),
  historyLeft: DEMO_HISTORY_LEFT.map((r) => ({ ...r, job: { ...r.job } })),
  undoStack: [],
};

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function findJob(jobId) {
  return (
    state.feedJobs.find((j) => j.job_id === jobId)
    || state.applications.find((a) => a.job_id === jobId)?.job
    || [...state.historyRight, ...state.historyLeft].find((r) => r.job_id === jobId)?.job
    || DEMO_JOBS.find((j) => j.job_id === jobId)
  );
}

function removeFromFeed(jobId) {
  state.feedJobs = state.feedJobs.filter((j) => j.job_id !== jobId);
}

function handleSwipe(body = {}) {
  const { job_id: jobId, direction } = body;
  const job = findJob(jobId);
  if (!job) return { ok: false };

  removeFromFeed(jobId);
  const row = demoSwipeRow(job, direction);
  state.undoStack.push({ job: { ...job }, direction, row });

  if (direction === "right") {
    if (isDemoAccountEnabled()) consumeDemoCredit();
    state.historyRight.unshift(row);
    const application = {
      application_id: `demo_app_${Date.now()}`,
      job_id: jobId,
      job: { ...job },
      status: "applied",
      submission_status: "not_submitted",
      match_score: job.match_score,
      match_reasons: job.match_reasons,
      created_at: new Date().toISOString(),
      tailored_resume: {
        summary: "Tailored CV generated for demo.",
        highlights: ["Relevant stack match", "Product shipping experience"],
      },
      cover_letter: {
        greeting: `Hi ${job.company} team,`,
        body: `I'm excited about the ${job.title} role.`,
        closing: "Best,\nAlex Martin",
      },
    };
    state.applications.unshift(application);
    return { ok: true, applied: true, application_id: application.application_id };
  }

  state.historyLeft.unshift(row);
  return { ok: true, applied: false };
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

/** Return mock payload for a dev demo request, or undefined to hit the real API. */
export function getDemoResponse(config) {
  const method = (config.method || "get").toLowerCase();
  const { path, params } = parseApiPath(axios.getUri(config));
  const body = config.data;

  if (method === "get" && path === "/auth/me") {
    return {
      user: {
        user_id: "dev-local",
        email: "dev@localhost",
        name: "Dev User",
        demo_account: false,
      },
      has_profile: Boolean(DEMO_PROFILE.cv_text),
      has_preferences: Boolean(DEMO_PROFILE.target_role),
    };
  }

  if (method === "get" && path === "/profile") {
    return mergeDemoCvIntoProfile(clone(DEMO_PROFILE));
  }

  if (method === "put" && path === "/profile/preferences") {
    const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    if (body?.target_role) DEMO_PROFILE.target_role = body.target_role;
    if (body?.target_roles) DEMO_PROFILE.target_roles = body.target_roles;
    if (body?.target_location !== undefined) DEMO_PROFILE.target_location = body.target_location;
    if (body?.target_location_data !== undefined) DEMO_PROFILE.target_location_data = body.target_location_data;
    if (body?.remote_preference) DEMO_PROFILE.remote_preference = body.remote_preference;
    return { ok: true };
  }

  if (method === "post" && path === "/profile/documents") {
    const file = config.data instanceof FormData ? config.data.get("file") : null;
    const name = file?.name || "document.pdf";
    const doc = {
      id: `demo-doc-${Date.now()}`,
      name,
      mime: "application/pdf",
      uploaded_at: new Date().toISOString(),
      size: file?.size || 0,
    };
    DEMO_PROFILE.additional_documents = [...(DEMO_PROFILE.additional_documents || []), doc];
    return { ok: true, document: doc };
  }

  if (method === "post" && path === "/profile/cover-letter") {
    const file = config.data instanceof FormData ? config.data.get("file") : null;
    const name = file?.name || "cover_letter.pdf";
    const uploadedAt = new Date().toISOString();
    DEMO_PROFILE.cover_letter_filename = name;
    DEMO_PROFILE.cover_letter_mime = "application/pdf";
    DEMO_PROFILE.cover_letter_uploaded_at = uploadedAt;
    DEMO_PROFILE.cover_letter_text = "Demo cover letter reference text.";
    return {
      ok: true,
      cover_letter_filename: name,
      cover_letter_uploaded_at: uploadedAt,
      has_cover_letter_text: true,
    };
  }

  if (method === "delete" && path === "/profile/cover-letter") {
    delete DEMO_PROFILE.cover_letter_filename;
    delete DEMO_PROFILE.cover_letter_mime;
    delete DEMO_PROFILE.cover_letter_uploaded_at;
    delete DEMO_PROFILE.cover_letter_text;
    return { ok: true };
  }

  if (method === "delete" && path.startsWith("/profile/documents/")) {
    const id = path.replace("/profile/documents/", "");
    DEMO_PROFILE.additional_documents = (DEMO_PROFILE.additional_documents || []).filter((doc) => doc.id !== id);
    return { ok: true };
  }

  if (method === "get" && path === "/jobs/feed") {
    const requestUrl = axios.getUri(config);
    const query = requestUrl.includes("?") ? requestUrl.slice(requestUrl.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    const filters = feedQueryToFilters(params);
    const searchRole = params.get("search_role") || "";
    const limit = Number(params.get("limit") || 5);
    const filtered = applyJobFilters(state.feedJobs, filters, {
      searchRole,
      profileLocationData: DEMO_PROFILE.target_location_data,
    });
    return {
      jobs: clone(filtered.slice(0, limit)),
      total: filtered.length,
      fallback_reason: filtered.length ? null : "no_jobs_for_filters",
      demo_mode: true,
      backend_api_mocked: true,
      filters_applied: filters,
    };
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

  if (method === "delete" && path.startsWith("/swipes/")) {
    const jobId = path.replace("/swipes/", "");
    state.historyRight = state.historyRight.filter((r) => r.job_id !== jobId);
    state.historyLeft = state.historyLeft.filter((r) => r.job_id !== jobId);
    return { ok: true };
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

  if (method === "patch" && path.endsWith("/status")) {
    const id = path.replace("/applications/", "").replace("/status", "");
    const status = (typeof body === "string" ? JSON.parse(body) : body)?.status;
    const app = state.applications.find((a) => a.application_id === id);
    if (app && status) app.status = status;
    return { ok: true };
  }

  if (method === "get" && path.startsWith("/coach/interview")) {
    return clone(DEMO_INTERVIEW_PREP);
  }

  if (method === "get" && path === "/coach/streak") {
    return clone(DEMO_STREAK);
  }

  if (method === "get" && path.startsWith("/coach/improve")) {
    return clone(DEMO_IMPROVE);
  }

  if (method === "post" && path === "/coach/interview/score") {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    const answers = parsed?.answers || [];
    const wordCount = answers.join(" ").trim().split(/\s+/).filter(Boolean).length;
    const bonus = Math.min(12, Math.floor(wordCount / 20));
    return {
      ...clone(DEMO_INTERVIEW_SCORE),
      overall: Math.min(95, DEMO_INTERVIEW_SCORE.overall + bonus),
      technical: Math.min(95, DEMO_INTERVIEW_SCORE.technical + bonus),
    };
  }

  if (method === "get" && path === "/training/catalog") {
    return getDemoTrainingCatalog(params.lang);
  }

  if (method === "get" && path.startsWith("/training/courses/")) {
    const courseId = path.replace("/training/courses/", "");
    return getDemoTrainingCourseDetail(courseId, params.lang);
  }

  if (method === "post" && /^\/training\/courses\/[^/]+\/enroll$/.test(path)) {
    return { ok: true, enrollment: { enrolled: true, progress_percent: 0, completed_module_ids: [] } };
  }

  if (method === "post" && /^\/training\/courses\/[^/]+\/modules\/[^/]+\/complete$/.test(path)) {
    return { ok: true, progress_percent: 10, completed_module_ids: [] };
  }

  if (method === "get" && path === "/admin/overview") {
    return {
      metrics: {
        total_users: 24,
        new_users_today: 2,
        applications_today: 5,
        prepared_applications: 8,
        action_required: 1,
        failed_blocked: 2,
        submitted: 12,
        conversion: { generated: 18, prepared: 8, submitted: 12 },
      },
      top_blockers: [
        { label: "Missing phone number", count: 3 },
        { label: "Security check needed", count: 1 },
      ],
      latest_attention: [],
    };
  }

  if (method === "get" && path === "/admin/users") {
    return { users: [] };
  }

  if (method === "get" && path === "/admin/creators") {
    return { creators: [] };
  }

  if (method === "get" && path === "/admin/analytics") {
    return {
      funnel: {
        landing_views: 0,
        signups: 0,
        onboarding_started: 0,
        onboarding_completed: 0,
        cv_uploaded: 0,
        first_swipe: 0,
        first_apply: 0,
      },
      conversion_rates: {},
      ats_performance: {},
      events_available: false,
    };
  }

  if (method === "get" && path.startsWith("/admin/applications")) {
    return { applications: [], filter: params.filter || "all" };
  }

  if (method === "get" && path === "/admin/training/invites") {
    return { invites: [] };
  }

  if (method === "get" && path === "/admin/training/analytics") {
    return {
      course_id: "course_job_search_mastery",
      enrolled: 0,
      modules: [],
    };
  }

  if (method === "get" && path === "/admin/training/videos") {
    return { slots: [] };
  }

  if (method === "get" && path === "/admin/demo/invites") {
    return { invites: [] };
  }

  if (method === "post" && path === "/admin/demo/invites") {
    return {
      ok: true,
      invitation: { code: "654321", invite_type: "demo" },
      code: "654321",
      invite_type: "demo",
    };
  }

  if (method === "post" && /^\/admin\/influencers\/[^/]+\/demo-invite$/.test(path)) {
    return {
      ok: true,
      invitation: { code: "654321", invite_type: "demo" },
      code: "654321",
      invite_type: "demo",
    };
  }

  if (method === "post" && /^\/admin\/influencers\/[^/]+\/invite$/.test(path)) {
    return {
      ok: true,
      invitation: { code: "123456", invite_type: "training" },
      code: "123456",
      invite_type: "training",
    };
  }

  if (method === "post" && path === "/admin/training/invites") {
    const payload = typeof body === "string" ? JSON.parse(body) : body;
    return {
      ok: true,
      invitation: {
        code: "123456",
        invite_url: "https://tryhirly.com/invite/123456",
        email_hint: payload?.email_hint || "",
        invite_type: "training",
      },
    };
  }

  if (method === "get" && path === "/admin/feedback") {
    const tab = params?.tab || "users";
    if (tab === "creators") {
      return { tab: "creators", feature_suggestions: [], training_feedback: [] };
    }
    return { tab: "users", feature_suggestions: [] };
  }

  if (method === "get" && path.startsWith("/admin/feedback/")) {
    return {
      submission: {
        id: path.split("/").pop(),
        feedback_type: "feature_user",
        message: "Demo feedback entry",
        created_at: new Date().toISOString(),
      },
    };
  }

  if (method === "post" && path === "/feedback/training-completion") {
    return { ok: true, submission_id: "demo_training_feedback" };
  }

  if (method === "post" && path === "/feedback/suggest-feature") {
    return { ok: true, submission_id: "demo_feature", transport: "archive" };
  }

  if (method === "get" && path === "/admin/influencers") {
    return { influencers: [] };
  }

  if (method === "post" && path === "/admin/influencers") {
    return { ok: true, influencer: { influencer_id: `demo_inf_${Date.now()}`, ...(typeof body === "string" ? JSON.parse(body) : body) } };
  }

  if (method === "post" && /^\/admin\/influencers\/[^/]+\/grant-demo$/.test(path)) {
    return { ok: true, email: "dev@localhost", demo_account: true, user_id: "dev-local" };
  }

  const inviteMock = getInviteDevResponse(config);
  if (inviteMock !== undefined) return inviteMock;

  return undefined;
}
