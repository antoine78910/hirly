import { api } from "./api";

const ANONYMOUS_ID_KEY = "hirly.analytics.anonymous_id";
const SENSITIVE_PROPERTY_KEYS = new Set([
  "cv_text",
  "resume",
  "cover_letter",
  "email",
  "phone",
  "name",
  "linkedin",
  "token",
  "session_token",
  "password",
  "access_token",
  "refresh_token",
]);

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

const sanitizeProperties = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeProperties);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_PROPERTY_KEYS.has(String(key).toLowerCase()))
      .map(([key, item]) => [key, sanitizeProperties(item)]),
  );
};

export const trackEvent = (event, properties = {}) => {
  if (!event) return Promise.resolve();
  const payload = {
    event,
    properties: sanitizeProperties(properties || {}),
    anonymous_id: getAnonymousId(),
    page: typeof window !== "undefined" ? window.location.pathname : undefined,
    source: typeof document !== "undefined" ? document.referrer || undefined : undefined,
  };
  return api.post("/analytics/event", payload).catch(() => {});
};
