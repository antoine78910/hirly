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
import { buildDemoApplicationFromSwipe } from "./demoApplicationFactory";
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

function demoCursorError() {
  const error = new Error("Invalid admin cursor");
  error.response = { status: 422, data: { detail: "Invalid admin cursor" } };
  return error;
}

function demoCursorSignature(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function demoBase64Url(value) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function demoBase64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw demoCursorError();
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}

function demoScopeHash(value) {
  return demoCursorSignature(JSON.stringify(value));
}

function encodeDemoCursor(payload) {
  const body = JSON.stringify(payload);
  return `${demoBase64Url(body)}.${demoCursorSignature(body)}`;
}

function decodeDemoCursor(cursor, resource, scopeHash) {
  if (!cursor) return null;
  try {
    const [encoded, signature, ...extra] = String(cursor).split(".");
    if (!encoded || !signature || extra.length) throw demoCursorError();
    const body = demoBase64UrlDecode(encoded);
    if (signature !== demoCursorSignature(body)) throw demoCursorError();
    const payload = JSON.parse(body);
    if (
      payload?.v !== 1 ||
      payload?.resource !== resource ||
      !["next", "previous"].includes(payload?.direction) ||
      payload?.scope_hash !== scopeHash ||
      typeof payload?.sort_at !== "string" ||
      typeof payload?.id !== "string"
    )
      throw demoCursorError();
    return payload;
  } catch (error) {
    if (error?.response?.status === 422) throw error;
    throw demoCursorError();
  }
}

function compareDemoAdminRows(left, right, sortField, idField) {
  const leftTime = String(left?.[sortField] || "-infinity");
  const rightTime = String(right?.[sortField] || "-infinity");
  if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
  return String(left?.[idField] || "").localeCompare(String(right?.[idField] || ""));
}

function cursorAdminRows(rows, params, { resource, sortField, idField, scope }) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(params.limit || "100", 10) || 100));
  const scopeHash = demoScopeHash({ resource, limit, ...scope });
  const cursor = decodeDemoCursor(params.cursor, resource, scopeHash);
  const sorted = [...rows].sort((left, right) =>
    compareDemoAdminRows(left, right, sortField, idField),
  );
  let start = 0;
  if (cursor) {
    const anchor = { [sortField]: cursor.sort_at, [idField]: cursor.id };
    const insertion = sorted.findIndex(
      (row) => compareDemoAdminRows(row, anchor, sortField, idField) >= 0,
    );
    const anchorIndex = sorted.findIndex(
      (row) =>
        String(row?.[sortField] || "-infinity") === cursor.sort_at &&
        String(row?.[idField] || "") === cursor.id,
    );
    const boundary = anchorIndex >= 0 ? anchorIndex : insertion >= 0 ? insertion : sorted.length;
    start =
      cursor.direction === "previous"
        ? Math.max(0, boundary - limit)
        : Math.min(sorted.length, boundary + (anchorIndex >= 0 ? 1 : 0));
  }
  const pageRows = sorted.slice(start, start + limit);
  const hasPrevious = start > 0;
  const hasNext = start + pageRows.length < sorted.length;
  const makeCursor = (row, direction) =>
    row
      ? encodeDemoCursor({
          v: 1,
          resource,
          direction,
          sort_at: String(row?.[sortField] || "-infinity"),
          id: String(row?.[idField] || ""),
          scope_hash: scopeHash,
        })
      : null;
  const now = new Date().toISOString();
  return {
    rows: pageRows,
    total: sorted.length,
    has_previous: hasPrevious,
    has_next: hasNext,
    previous_cursor: hasPrevious ? makeCursor(pageRows[0], "previous") : null,
    next_cursor: hasNext ? makeCursor(pageRows.at(-1), "next") : null,
    generated_at: now,
    model_updated_at: now,
    canonical_changed_at: now,
    freshness_lag_seconds: 0,
    read_model_version: 3,
  };
}

function findJob(jobId) {
  return (
    state.feedJobs.find((j) => j.job_id === jobId) ||
    state.applications.find((a) => a.job_id === jobId)?.job ||
    [...state.historyRight, ...state.historyLeft].find((r) => r.job_id === jobId)?.job ||
    DEMO_JOBS.find((j) => j.job_id === jobId)
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
    const application = buildDemoApplicationFromSwipe(job);
    application.application_id = `demo_app_${Date.now()}`;
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
    if (body?.target_location_data !== undefined)
      DEMO_PROFILE.target_location_data = body.target_location_data;
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
    DEMO_PROFILE.additional_documents = (DEMO_PROFILE.additional_documents || []).filter(
      (doc) => doc.id !== id,
    );
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

  if (method === "delete" && path === "/profile") {
    return { ok: true };
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
    return {
      ok: true,
      enrollment: { enrolled: true, progress_percent: 0, completed_module_ids: [] },
    };
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
    const query = String(params.q || "")
      .trim()
      .toLowerCase();
    const payingOnly = ["1", "true", "yes"].includes(
      String(params.paying_only || "").toLowerCase(),
    );
    const allUsers = [
      {
        user_id: "demo-user",
        email: "demo@hirly.app",
        name: "Demo User",
        is_premium: true,
        plan: "pro",
        credits_total: 100,
        credits_remaining: 84,
        profile_completion: 100,
        cv_uploaded: true,
        total_applications: state.applications.length,
        total_swipes: state.historyRight.length + state.historyLeft.length,
        right_swipes: state.historyRight.length,
        left_swipes: state.historyLeft.length,
        last_active_at: "2026-07-20T12:00:00+00:00",
      },
    ];
    const matching = allUsers.filter((user) => {
      const searchMatches =
        !query || [user.user_id, user.email, user.name].join(" ").toLowerCase().includes(query);
      return searchMatches && (!payingOnly || user.is_premium);
    });
    const paged = cursorAdminRows(matching, params, {
      resource: "users",
      sortField: "last_active_at",
      idField: "user_id",
      scope: { q: query || null, paying_only: payingOnly },
    });
    const { rows, ...metadata } = paged;
    return {
      contract_version: "admin-users-cursor/v3",
      users: rows,
      ...metadata,
      aggregates: { matching_paying: matching.filter((user) => user.is_premium).length },
    };
  }

  if (method === "get" && path === "/admin/user-analytics") {
    const paged = cursorAdminRows([], params, {
      resource: "user-analytics",
      sortField: "last_active_at",
      idField: "user_id",
      scope: {
        q:
          String(params.q || "")
            .trim()
            .toLowerCase() || null,
      },
    });
    const { rows, ...metadata } = paged;
    return {
      contract_version: "admin-user-analytics-cursor/v2",
      users: rows,
      ...metadata,
      summary: {
        total_users: 0,
        onboarding_completed: 0,
        onboarding_in_progress: 0,
        onboarding_never_started: 0,
        avg_time_spent_minutes: 0,
        total_swipes: 0,
        total_applications: 0,
      },
      onboarding_dropoff: { by_step: [], never_started: 0, in_progress: 0, completed: 0 },
      answer_distributions: [],
    };
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
    const filter = params.filter || params.status || "all";
    const normalized = clone(state.applications);
    const matching =
      filter === "all"
        ? normalized
        : normalized.filter(
            (application) =>
              application.submission_status === filter ||
              application.manual_status === filter ||
              (filter === "prepared" &&
                ["ready", "prepared"].includes(application.submission_status)),
          );
    const activeQueue = normalized.filter((application) =>
      ["queued", "running", "awaiting_review"].includes(application.auto_apply_queue_status),
    );
    const queueItems = activeQueue.slice(0, 20);
    const paged = cursorAdminRows(matching, params, {
      resource: "applications",
      sortField: "sort_at",
      idField: "application_id",
      scope: { filter: filter === "all" ? null : filter },
    });
    const { rows, ...metadata } = paged;
    return {
      contract_version: "admin-applications-cursor/v3",
      applications: rows,
      ...metadata,
      filter,
      queue: { active_count: activeQueue.length, items: queueItems },
    };
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

  if (method === "post" && path === "/feedback/contact") {
    return { ok: true, submission_id: "demo_contact", transport: "archive" };
  }

  if (method === "get" && path === "/admin/influencers") {
    return { influencers: [] };
  }

  if (method === "post" && path === "/admin/influencers") {
    return {
      ok: true,
      influencer: {
        influencer_id: `demo_inf_${Date.now()}`,
        ...(typeof body === "string" ? JSON.parse(body) : body),
      },
    };
  }

  if (method === "post" && /^\/admin\/influencers\/[^/]+\/grant-demo$/.test(path)) {
    return { ok: true, email: "dev@localhost", demo_account: true, user_id: "dev-local" };
  }

  const inviteMock = getInviteDevResponse(config);
  if (inviteMock !== undefined) return inviteMock;

  return undefined;
}
