import { api } from "./api";
import {
  capturePostHogEvent,
  sanitizeAnalyticsProperties,
  stripUrlSecrets,
} from "./posthogClient";

const ANONYMOUS_ID_KEY = "hirly.analytics.anonymous_id";
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

export const trackEvent = (event, properties = {}) => {
  if (!event) return Promise.resolve();
  const sanitizedProperties = sanitizeAnalyticsProperties(properties || {}) || {};
  const payload = {
    event,
    properties: sanitizedProperties,
    anonymous_id: getAnonymousId(),
    page: typeof window !== "undefined" ? window.location.pathname : undefined,
    source: typeof document !== "undefined" && document.referrer
      ? stripUrlSecrets(document.referrer)
      : undefined,
  };
  try {
    capturePostHogEvent(event, sanitizedProperties);
  } catch (_) {
    // Keep the first-party sink independent even if the vendor adapter regresses.
  }
  return api.post("/analytics/event", payload).catch(() => {});
};
