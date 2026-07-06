const normalizeOrigin = (value, fallback) => {
  const raw = (value || fallback || "").trim();
  if (!raw) return fallback;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
};

export const MARKETING_ORIGIN = normalizeOrigin(
  process.env.REACT_APP_MARKETING_ORIGIN,
  "https://tryhirly.com",
);

export const APP_ORIGIN = normalizeOrigin(
  process.env.REACT_APP_APP_ORIGIN,
  "https://app.tryhirly.com",
);

const MARKETING_HOSTS = new Set(["tryhirly.com", "www.tryhirly.com"]);
const APP_HOSTS = new Set(["app.tryhirly.com"]);

const APP_ROUTE_PREFIXES = [
  "/app",
  "/swipe",
  "/review",
  "/feedback",
  "/interviews",
  "/improve",
  "/people",
  "/tracker",
  "/emails",
  "/profile",
  "/credits",
  "/billing",
  "/referral",
  "/settings",
  "/history",
  "/admin",
];

const MARKETING_ROUTE_PREFIXES = [
  "/how-it-works",
  "/use-cases",
  "/blog",
  "/compare",
  "/for",
  "/signup",
  "/onboarding",
  "/invite",
  "/training",
];

const SHARED_ROUTE_PREFIXES = ["/auth/callback", "/terms", "/privacy"];

export function currentHostname() {
  if (typeof window === "undefined") return "";
  return window.location.hostname.toLowerCase();
}

export function isLocalDevHost() {
  const host = currentHostname();
  return host === "localhost" || host === "127.0.0.1";
}

export function domainSplitEnabled() {
  if (isLocalDevHost()) return false;
  const host = currentHostname();
  return MARKETING_HOSTS.has(host) || APP_HOSTS.has(host);
}

export function isAppHost() {
  if (isLocalDevHost()) return false;
  return APP_HOSTS.has(currentHostname());
}

export function isMarketingHost() {
  if (isLocalDevHost()) return false;
  return MARKETING_HOSTS.has(currentHostname());
}

export function isAppPath(pathname) {
  const path = pathname || "";
  return APP_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isMarketingPath(pathname) {
  const path = pathname || "";
  if (path === "/") return true;
  return MARKETING_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isSharedPath(pathname) {
  const path = pathname || "";
  return SHARED_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function marketingUrl(path = "/", search = "", hash = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${MARKETING_ORIGIN}${normalizedPath}${search || ""}${hash || ""}`;
}

export function appUrl(path = "/", search = "", hash = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${APP_ORIGIN}${normalizedPath}${search || ""}${hash || ""}`;
}

/** Full-page navigation to the app subdomain (or in-app route on localhost). */
export function goToApp(path = "/swipe", search = "", hash = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!domainSplitEnabled() || isAppHost()) {
    window.location.assign(`${normalizedPath}${search || ""}${hash || ""}`);
    return;
  }
  window.location.assign(appUrl(normalizedPath, search, hash));
}

/** Full-page navigation to the marketing subdomain (or in-app route on localhost). */
export function goToMarketing(path = "/", search = "", hash = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!domainSplitEnabled() || isMarketingHost()) {
    window.location.assign(`${normalizedPath}${search || ""}${hash || ""}`);
    return;
  }
  window.location.assign(marketingUrl(normalizedPath, search, hash));
}

/**
 * Resolve where a post-auth path should live when domains are split.
 * Returns a same-origin path for react-router or a full URL for cross-domain redirect.
 */
export function resolvePostAuthDestination(pathname, search = "") {
  const path = pathname.startsWith("/") ? pathname : `/${pathname || ""}`;
  const suffix = search || "";

  if (!domainSplitEnabled()) {
    return { type: "route", path: `${path}${suffix}` };
  }

  if (isAppPath(path) && isMarketingHost()) {
    return { type: "external", url: appUrl(path, suffix) };
  }

  if (isMarketingPath(path) && isAppHost()) {
    return { type: "external", url: marketingUrl(path, suffix) };
  }

  return { type: "route", path: `${path}${suffix}` };
}
