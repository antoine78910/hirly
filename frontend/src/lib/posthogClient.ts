import posthog, {
  type CaptureResult,
  type PostHog,
  type PostHogConfig,
  type Properties,
} from "posthog-js";

import { isAppPath } from "./appDomains";
import { resolveAnalyticsEvent } from "./analyticsRegistry";

const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_STRING_LENGTH = 500;
const URL_KEY_PATTERN = /(^|[_-])(url|uri|href|referrer|page|path)([_-]|$)/i;
const SENSITIVE_KEY_PATTERN =
  /(access|auth|bearer|card|code|coverletter|cv|document|email|linkedin|message|name|password|phone|refresh|resume|secret|session|token)/;
const ALLOWED_SYSTEM_EVENTS = new Set(["$identify", "$pageview"]);
// posthog-js adds these after caller-controlled properties have already crossed
// the sanitizing capture boundary. Removing them in before_send drops otherwise
// valid events before transport.
const TRUSTED_SDK_PROPERTY_KEYS = new Set(["token", "$session_id", "$window_id"]);
const CANONICAL_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const POSTHOG_API_HOST = "https://t.tryhirly.com";
// The first 5,000 replay recordings are free each month. Keep the core app at
// a deterministic 1% sample. Onboarding deliberately overrides this rate so
// every onboarding journey is captured.
const POSTHOG_APP_REPLAY_SAMPLE_RATE = 0.01;

let client: PostHog | null = null;
let initialized = false;
let lastCapturedPath: string | null = null;
let identifiedUserId: string | null = null;
let identifiedPersonPropertiesKey: string | null = null;

export interface PostHogIdentityProfile {
  email?: unknown;
  name?: unknown;
}

export type PostHogReplayMode = "none" | "onboarding" | "sampled-app";

export const resolvePostHogReplayMode = (pathname: string): PostHogReplayMode => {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (normalizedPathname === "/onboarding" || normalizedPathname.startsWith("/onboarding/")) {
    return "onboarding";
  }
  // Admin is intentionally excluded: replay is for the candidate product
  // journey, not operational back-office data.
  if (isAppPath(normalizedPathname) && !normalizedPathname.startsWith("/admin")) {
    return "sampled-app";
  }
  return "none";
};

const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

export const buildPostHogPersonProperties = (profile: PostHogIdentityProfile = {}): Properties => {
  const properties: Properties = {};
  if (typeof profile.email === "string") {
    const email = profile.email.trim().toLowerCase();
    if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      properties.email = email;
    }
  }
  if (typeof profile.name === "string") {
    const parts = profile.name.trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift()?.slice(0, 100);
    const lastName = parts.join(" ").slice(0, 100);
    if (firstName && !hasControlCharacter(firstName)) {
      properties.first_name = firstName;
    }
    if (lastName && !hasControlCharacter(lastName)) {
      properties.last_name = lastName;
    }
  }
  return properties;
};

const sanitizeIdentifyPersonSet = (value: unknown): Properties | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const profile = buildPostHogPersonProperties({
    email: source.email,
    name: [source.first_name, source.last_name]
      .filter((part): part is string => typeof part === "string")
      .join(" "),
  });
  return Object.keys(profile).length > 0 ? profile : null;
};

export const stripUrlSecrets = (value: string): string => {
  try {
    const parsed = new URL(
      value,
      typeof window !== "undefined" ? window.location.origin : "https://invalid.local",
    );
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
  if (!ALLOWED_SYSTEM_EVENTS.has(event.event) && !resolveAnalyticsEvent(event.event)) {
    return null;
  }
  const sdkProperties: Properties = {};
  const callerProperties: Properties = {};
  for (const [key, value] of Object.entries(event.properties || {})) {
    if (event.event === "$identify" && key === "$set") continue;
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
  if (event.event === "$identify") {
    const personSet = sanitizeIdentifyPersonSet(event.properties?.$set);
    if (personSet) properties.$set = personSet;
  }
  for (const key of [
    "$current_url",
    "$referrer",
    "$pathname",
    "current_url",
    "referrer",
    "url",
    "path",
  ]) {
    if (typeof properties[key] === "string")
      properties[key] = stripUrlSecrets(properties[key] as string);
  }
  return { ...event, properties };
};

// Session replay is explicitly paused to prevent further recording charges.
// Re-enabling it requires a reviewed code change, rather than only a deployment
// environment change.
export const isReplayEnabled = (): boolean => false;

export const buildPostHogConfig = (): Partial<PostHogConfig> => {
  return {
    api_host: POSTHOG_API_HOST,
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    disable_surveys: true,
    // Do not auto-start replay. The route lifecycle starts onboarding at 100%
    // and the candidate app at 1%; all marketing and admin routes remain off.
    disable_session_recording: true,
    // Remote feature flags are the production control plane for operational UI
    // such as the maintenance banner. Automatic capture remains disabled and
    // `$feature_flag_called` events are still rejected by before_send.
    advanced_disable_flags: false,
    advanced_disable_feature_flags: false,
    enable_recording_console_log: false,
    capture_performance: false,
    session_recording: {
      sampleRate: POSTHOG_APP_REPLAY_SAMPLE_RATE,
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
  if (!token) return null;
  try {
    client = posthog.init(token, buildPostHogConfig()) || null;
    // Clear any persisted recorder state before the route policy decides whether
    // the current page may record.
    client?.stopSessionRecording();
    return client;
  } catch {
    client = null;
    return null;
  }
};

export const getPostHogClient = (): PostHog | null => client;

export const isCanonicalAnalyticsUserId = (value: unknown): value is string =>
  typeof value === "string" && CANONICAL_USER_ID_PATTERN.test(value);

export const hasIdentifiedPostHogUser = (): boolean => identifiedUserId !== null;

export const capturePostHogEvent = (
  event: string,
  properties: Properties = {},
  occurredAt?: string,
): void => {
  if (!event || !client) return;
  try {
    client.capture(
      event,
      sanitizeAnalyticsProperties(properties) as Properties,
      occurredAt ? { timestamp: new Date(occurredAt) } : undefined,
    );
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

export const identifyPostHogUser = (userId: string, profile: PostHogIdentityProfile = {}): void => {
  if (!client) return;
  if (!isCanonicalAnalyticsUserId(userId)) return;
  const personProperties = buildPostHogPersonProperties(profile);
  const personPropertiesKey = JSON.stringify(personProperties);
  if (identifiedUserId === userId && identifiedPersonPropertiesKey === personPropertiesKey) {
    return;
  }
  try {
    // Preserve the current anonymous distinct ID on the first authentication so
    // PostHog can merge pre-signup activity into the canonical auth UUID. Reset
    // only when switching directly between two identified accounts.
    if (identifiedUserId !== null && identifiedUserId !== userId) client.reset();
    client.identify(userId, personProperties);
    identifiedUserId = userId;
    identifiedPersonPropertiesKey = personPropertiesKey;
  } catch {}
};

export const resetPostHog = (): void => {
  if (!client) return;
  try {
    client.stopSessionRecording();
    client.reset();
    identifiedUserId = null;
    identifiedPersonPropertiesKey = null;
  } catch {}
};

export const syncPostHogReplay = (pathname: string): void => {
  if (!client) return;
  try {
    const replayMode = resolvePostHogReplayMode(pathname);
    if (!isReplayEnabled() || replayMode === "none") {
      client.stopSessionRecording();
    } else if (replayMode === "onboarding") {
      // Override the 1% app sample only for the high-value onboarding flow.
      client.startSessionRecording({ sampling: true });
    } else {
      client.startSessionRecording();
    }
  } catch {}
};

export const __resetPostHogForTests = (): void => {
  client = null;
  initialized = false;
  lastCapturedPath = null;
  identifiedUserId = null;
  identifiedPersonPropertiesKey = null;
};
