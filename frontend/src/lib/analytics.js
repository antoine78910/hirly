import { api } from "./api";
import {
  capturePostHogEvent,
  sanitizeAnalyticsProperties,
  stripUrlSecrets,
} from "./posthogClient";

export const ANALYTICS_OUTBOX_KEY = "hirly.analytics.outbox";
export const ANALYTICS_BATCH_MAX_EVENTS = 20;
export const ANALYTICS_BATCH_MAX_BYTES = 64 * 1024;
export const ANALYTICS_OUTBOX_MAX_EVENTS = 100;
export const ANALYTICS_OUTBOX_MAX_BYTES = 256 * 1024;
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
const ANONYMOUS_ID_KEY = "hirly.analytics.anonymous_id";
const CRITICAL_EVENTS = new Set([
  "cta_signup_clicked",
  "cta_start_swiping_clicked",
  "cta_login_clicked",
  "auth_success",
  "onboarding_completed",
]);
const EVENT_ALLOWLIST = new Set([
  "landing_view",
  "cta_login_clicked",
  "cta_start_swiping_clicked",
  "cta_signup_clicked",
  "landing_account_logout",
  "checkout_started",
  "auth_success",
  "onboarding_started",
  "onboarding_completed",
  "signin_page_view",
  "login_email_submitted",
  "signin_google_clicked",
  "profile_updated",
  "profile_view",
  "application_generated",
  "application_submitted",
  "application_action_required",
  "application_blocked",
  "application_defaults_updated",
  "application_generation_started",
  "application_prepare_failed",
  "application_prepared",
  "action_required_answer_saved",
  "admin_application_assigned",
  "admin_application_email_sent",
  "admin_application_opened",
  "admin_status_updated",
  "admin_view",
  "cv_upload_completed",
  "cv_upload_failed",
  "cv_upload_started",
  "filters_applied",
  "swipe_page_view",
  "job_card_viewed",
  "job_swiped_left",
  "job_swiped_right",
  "onboarding_step_completed",
  "password_reset_completed",
  "password_reset_page_view",
  "password_reset_requested",
  "prepare_again_clicked",
  "tracker_view",
  "friend_referral_enrolled",
  "friend_referral_shared",
  "friend_referral_redeemed",
  "friend_referral_progress",
]);

let flushPromise = null;
let retryAttempt = 0;
let retryTimer = null;

const getAnonymousId = () => {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      const random = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      id = `anon_${random}`;
      window.localStorage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return null;
  }
};

const newId = (prefix) => {
  const random = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
};

const byteLength = (value) => new Blob([JSON.stringify(value)]).size;

export const readAnalyticsOutbox = () => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ANALYTICS_OUTBOX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};

const writeAnalyticsOutbox = (events) => {
  if (typeof window === "undefined") return false;
  try {
    if (events.length) window.localStorage.setItem(ANALYTICS_OUTBOX_KEY, JSON.stringify(events));
    else window.localStorage.removeItem(ANALYTICS_OUTBOX_KEY);
    return true;
  } catch (_) {
    return false;
  }
};

const emitCriticalOverflowMetric = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hirly:analytics_outbox_overflow", { detail: { critical: true } }));
    window.__hirlyAnalyticsMetrics = window.__hirlyAnalyticsMetrics || {};
    window.__hirlyAnalyticsMetrics.criticalOverflow = (window.__hirlyAnalyticsMetrics.criticalOverflow || 0) + 1;
  }
  console.warn("analytics_outbox_critical_overflow");
};

const pruneOutbox = (events, now = Date.now()) => {
  const live = events.filter((item) => now - Number(item.created_at || 0) <= OUTBOX_TTL_MS);
  live.sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
  while (live.length > ANALYTICS_OUTBOX_MAX_EVENTS || byteLength(live) > ANALYTICS_OUTBOX_MAX_BYTES) {
    const bestEffortIndex = live.findIndex((item) => !item.critical);
    if (bestEffortIndex < 0) {
      emitCriticalOverflowMetric();
      break;
    }
    live.splice(bestEffortIndex, 1);
  }
  return live;
};

const enqueueEvent = (event) => {
  const existing = pruneOutbox(readAnalyticsOutbox());
  const next = pruneOutbox([...existing, event]);
  if ((next.length > ANALYTICS_OUTBOX_MAX_EVENTS || byteLength(next) > ANALYTICS_OUTBOX_MAX_BYTES)
    && next.every((item) => item.critical)) {
    emitCriticalOverflowMetric();
    return false;
  }
  return writeAnalyticsOutbox(next);
};

const takeBatch = (events) => {
  const batch = [];
  for (const event of events) {
    const candidate = [...batch, event];
    if (candidate.length > ANALYTICS_BATCH_MAX_EVENTS || byteLength(candidate) > ANALYTICS_BATCH_MAX_BYTES) break;
    batch.push(event);
  }
  return batch;
};

export const flushAnalyticsOutbox = async () => {
  if (flushPromise) return flushPromise;
  const events = pruneOutbox(readAnalyticsOutbox());
  if (!events.length) return undefined;
  writeAnalyticsOutbox(events);
  const batch = takeBatch(events);
  const batchId = batch[0]?.batch_id || newId("batch");
  flushPromise = api.post("/analytics/events", { batch_id: batchId, events: batch })
    .then((response) => {
      const accepted = new Set(response?.data?.accepted_event_ids || []);
      if (response?.data?.stored !== true || !accepted.size) throw new Error("analytics batch was not acknowledged");
      writeAnalyticsOutbox(readAnalyticsOutbox().filter((event) => !accepted.has(event.event_id)));
      retryAttempt = 0;
      if (readAnalyticsOutbox().length && typeof window !== "undefined") {
        window.setTimeout(() => flushAnalyticsOutbox(), 0);
      }
      return response;
    })
    .catch((error) => {
      retryAttempt = Math.min(retryAttempt + 1, 6);
      if (typeof window !== "undefined" && !retryTimer) {
        const baseDelay = [1000, 2000, 4000, 8000, 16000, 60000][retryAttempt - 1];
        const delay = Math.min(60000, Math.round(baseDelay * (0.8 + Math.random() * 0.4)));
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          flushAnalyticsOutbox();
        }, delay);
      }
      return undefined;
    })
    .finally(() => {
      flushPromise = null;
    });
  return flushPromise;
};

export const trackEvent = (event, properties = {}) => {
  if (!event || !EVENT_ALLOWLIST.has(event)) return Promise.resolve();
  const sanitizedProperties = sanitizeAnalyticsProperties(properties || {}) || {};
  const payload = {
    event,
    properties: sanitizedProperties,
    event_id: newId("evt"),
    batch_id: newId("batch"),
    critical: CRITICAL_EVENTS.has(event),
    created_at: Date.now(),
    anonymous_id: getAnonymousId(),
    page: typeof window !== "undefined" ? window.location.pathname : undefined,
    source: typeof document !== "undefined" && document.referrer
      ? stripUrlSecrets(document.referrer)
      : undefined,
  };
  try {
    capturePostHogEvent(event, sanitizedProperties);
  } catch (_) {
    // Keep the first-party sink independent if the vendor adapter regresses.
  }
  if (!enqueueEvent(payload)) {
    return api.post("/analytics/events", {
      batch_id: payload.batch_id,
      events: [payload],
    }).catch(() => {
      // Critical overflow is delivered immediately; retain it if that attempt fails.
      writeAnalyticsOutbox([...readAnalyticsOutbox(), payload].slice(-ANALYTICS_OUTBOX_MAX_EVENTS));
    });
  }
  return flushAnalyticsOutbox();
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flushAnalyticsOutbox());
  window.setTimeout(() => flushAnalyticsOutbox(), 0);
}
