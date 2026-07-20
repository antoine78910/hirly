import posthog, { type CaptureResult, type PostHog, type PostHogConfig, type Properties } from "posthog-js";

const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_STRING_LENGTH = 500;
const URL_KEY_PATTERN = /(^|[_-])(url|uri|href|referrer|page|path)([_-]|$)/i;
const SENSITIVE_KEY_PATTERN =
  /(access|auth|bearer|card|code|coverletter|cv|document|email|linkedin|message|name|password|phone|refresh|resume|secret|session|token)/;
const ALLOWED_CUSTOM_EVENTS = new Set([
  "action_required_answer_saved",
  "admin_application_assigned",
  "admin_application_email_sent",
  "admin_application_opened",
  "admin_status_updated",
  "admin_view",
  "application_action_required",
  "application_blocked",
  "application_defaults_updated",
  "application_generated",
  "application_generation_started",
  "application_prepare_failed",
  "application_prepared",
  "application_submitted",
  "auth_success",
  "checkout_started",
  "cta_login_clicked",
  "cta_signup_clicked",
  "cta_start_swiping_clicked",
  "cv_upload_completed",
  "cv_upload_failed",
  "cv_upload_started",
  "filters_applied",
  "friend_referral_enrolled",
  "friend_referral_progress",
  "friend_referral_redeemed",
  "friend_referral_shared",
  "job_card_viewed",
  "job_swiped_left",
  "job_swiped_right",
  "landing_account_logout",
  "landing_view",
  "login_email_submitted",
  "onboarding_completed",
  "onboarding_started",
  "onboarding_step_completed",
  "password_reset_completed",
  "password_reset_page_view",
  "password_reset_requested",
  "prepare_again_clicked",
  "profile_updated",
  "profile_view",
  "signin_google_clicked",
  "signin_page_view",
  "swipe_page_view",
  "tracker_view",
]);
const ALLOWED_SYSTEM_EVENTS = new Set(["$identify", "$pageview"]);
// These fields are added by posthog-js after our caller-controlled payload has
// already crossed the sanitizing capture boundary. Removing them in before_send
// makes otherwise valid events disappear at ingestion time.
const TRUSTED_SDK_PROPERTY_KEYS = new Set(["token", "$session_id", "$window_id"]);

let client: PostHog | null = null;
let initialized = false;
let lastCapturedPath: string | null = null;
let identifiedUserId: string | null = null;

export const stripUrlSecrets = (value: string): string => {
  try {
    const parsed = new URL(value, typeof window !== "undefined" ? window.location.origin : "https://invalid.local");
    return `${parsed.origin === "https://invalid.local" ? "" : parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
};

export const sanitizeAnalyticsProperties = (
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value !== "object" || depth >= MAX_DEPTH) return undefined;
  if (typeof Node !== "undefined" && value instanceof Node) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeAnalyticsProperties(item, depth + 1, seen))
      .filter((item) => item !== undefined);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(normalizedKey.replace(/[^a-z0-9]/g, ""))) continue;
    const safeValue =
      typeof item === "string" && URL_KEY_PATTERN.test(normalizedKey)
        ? stripUrlSecrets(item)
        : sanitizeAnalyticsProperties(item, depth + 1, seen);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  return sanitized;
};

export const sanitizePostHogEvent = (event: CaptureResult | null): CaptureResult | null => {
  if (!event) return null;
  if (event.event === "$snapshot") return isReplayEnabled() ? event : null;
  if (!ALLOWED_SYSTEM_EVENTS.has(event.event) && !ALLOWED_CUSTOM_EVENTS.has(event.event)) return null;
  const sdkProperties: Properties = {};
  const callerProperties: Properties = {};
  for (const [key, value] of Object.entries(event.properties || {})) {
    if (TRUSTED_SDK_PROPERTY_KEYS.has(key)) {
      if (typeof value === "string") sdkProperties[key] = value.slice(0, MAX_STRING_LENGTH);
      else if (typeof value === "number" || typeof value === "boolean") sdkProperties[key] = value;
    } else {
      callerProperties[key] = value;
    }
  }
  const properties = sanitizeAnalyticsProperties(callerProperties) as Properties | undefined;
  if (!properties) return null;
  Object.assign(properties, sdkProperties);
  for (const key of ["$current_url", "$referrer", "$pathname", "current_url", "referrer", "url", "path"]) {
    if (typeof properties[key] === "string") properties[key] = stripUrlSecrets(properties[key] as string);
  }
  return { ...event, properties };
};

export const isReplayEnabled = (): boolean =>
  process.env.REACT_APP_POSTHOG_REPLAY_ENABLED === "true"
  && process.env.REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED === "true";

export const buildPostHogConfig = (): Partial<PostHogConfig> => {
  const replayEnabled = isReplayEnabled();
  return {
    api_host: process.env.REACT_APP_POSTHOG_HOST?.trim(),
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    disable_surveys: true,
    disable_session_recording: !replayEnabled,
    ...(replayEnabled
      ? { advanced_disable_feature_flags: true }
      : { advanced_disable_flags: true }),
    enable_recording_console_log: false,
    capture_performance: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      recordCrossOriginIframes: false,
      captureCanvas: { recordCanvas: false },
      recordHeaders: false,
      recordBody: false,
    },
    before_send: sanitizePostHogEvent,
    get_current_url: (url) => stripUrlSecrets(url),
  };
};

export const initializePostHog = (): PostHog | null => {
  if (initialized) return client;
  initialized = true;
  const token = process.env.REACT_APP_POSTHOG_TOKEN?.trim();
  const host = process.env.REACT_APP_POSTHOG_HOST?.trim();
  if (!token || !host || !/^https:\/\//i.test(host)) return null;
  try {
    client = posthog.init(token, buildPostHogConfig()) || null;
    if (!isReplayEnabled()) client?.stopSessionRecording();
    return client;
  } catch {
    client = null;
    return null;
  }
};

export const getPostHogClient = (): PostHog | null => client;

export const capturePostHogEvent = (event: string, properties: Properties = {}): void => {
  if (!event || !client) return;
  try {
    client.capture(event, sanitizeAnalyticsProperties(properties) as Properties);
  } catch {
    // Analytics must never block product flows.
  }
};

export const capturePostHogPageview = (pathname: string): void => {
  if (!client || typeof window === "undefined") return;
  const canonicalPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (lastCapturedPath === canonicalPathname) return;
  lastCapturedPath = canonicalPathname;
  capturePostHogEvent("$pageview", {
    $current_url: `${window.location.origin}${canonicalPathname}`,
  });
};

export const identifyPostHogUser = (userId: string): void => {
  if (!client || !userId || identifiedUserId === userId) return;
  try {
    if (identifiedUserId) client.reset();
    client.identify(userId);
    identifiedUserId = userId;
  } catch {}
};

export const resetPostHog = (): void => {
  if (!client || !identifiedUserId) return;
  try {
    client.reset();
    identifiedUserId = null;
  } catch {}
};

export const syncPostHogReplay = (): void => {
  if (!client) return;
  try {
    if (isReplayEnabled()) client.startSessionRecording();
    else client.stopSessionRecording();
  } catch {}
};

export const __resetPostHogForTests = (): void => {
  client = null;
  initialized = false;
  lastCapturedPath = null;
  identifiedUserId = null;
};
