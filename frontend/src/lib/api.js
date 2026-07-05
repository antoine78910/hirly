import axios from "axios";
import { demoMode } from "./dev";
import { getDemoResponse } from "./demoApi";
import { getFinanceDemoResponse, patchFinanceDemoResponse } from "./financeDemoApi";
import { getDemoAccountResponse, isDemoAccountEnabled, patchDemoAccountResponse } from "./demoAccount";
import { isFinanceDemoEnabled } from "./demoSettings";
import { handleDemoCvUpload, shouldMockCvUpload, extractUploadFile } from "./demoCvUpload";
import { normalizeApiPath } from "./apiPath";
import { getInviteDevResponse } from "./inviteDevMocks";

const normalizeBackendUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "").replace(/\/api$/i, "");
};

const isLocalBackendUrl = (value) => /localhost|127\.0\.0\.1/i.test(value || "");

/** Prefer same-origin /api in production (Vercel rewrite → Railway). */
function resolveApiBase() {
  if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
    return "/api";
  }
  const envUrl = normalizeBackendUrl(process.env.REACT_APP_BACKEND_URL || "");
  if (typeof window !== "undefined" && isLocalBackendUrl(envUrl)) {
    return "/api";
  }
  return envUrl ? `${envUrl}/api` : "/api";
}

const BACKEND_URL = normalizeBackendUrl(process.env.REACT_APP_BACKEND_URL || "");
export const API = resolveApiBase();

/** Resolve API-relative media paths (e.g. uploaded training videos). */
export function resolveApiAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Same-origin static or proxied API paths in the browser.
  if (typeof window !== "undefined" && (normalized.startsWith("/api/") || normalized.startsWith("/training-videos/"))) {
    return normalized;
  }
  const apiOrigin = API.startsWith("http") ? API.replace(/\/api\/?$/i, "") : "";
  const base = (apiOrigin || BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}${normalized}`;
}

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  timeout: 20000,
});

// Fallback: if cookies are not sent (third-party context), use bearer token.
// Also mirrored in a shared cookie so app.tryhirly.com and tryhirly.com share sessions.
const TOKEN_KEY = "session_token";
const TOKEN_COOKIE = "hirly_session_token";

function sharedCookieDomain() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return null;
  if (host === "tryhirly.com" || host.endsWith(".tryhirly.com")) return ".tryhirly.com";
  return null;
}

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeSessionCookie(token) {
  if (typeof document === "undefined") return;
  const domain = sharedCookieDomain();
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  const domainPart = domain ? `; Domain=${domain}` : "";
  if (!token) {
    document.cookie = `${TOKEN_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${domainPart}${secure}`;
    return;
  }
  const maxAge = 60 * 60 * 24 * 30;
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${domainPart}${secure}`;
}

export const setSessionToken = (t) => {
  if (t) {
    localStorage.setItem(TOKEN_KEY, t);
    writeSessionCookie(t);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    writeSessionCookie(null);
  }
};

export const getSessionToken = () => {
  const local = localStorage.getItem(TOKEN_KEY);
  const fromCookie = readCookie(TOKEN_COOKIE);
  if (local) {
    if (local !== fromCookie) writeSessionCookie(local);
    return local;
  }
  if (fromCookie) {
    localStorage.setItem(TOKEN_KEY, fromCookie);
    return fromCookie;
  }
  return null;
};

api.interceptors.request.use((config) => {
  const t = getSessionToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;

  if (!config.adapter && shouldMockCvUpload()) {
    const method = (config.method || "get").toLowerCase();
    let requestUrl = config.url || "";
    try {
      requestUrl = axios.getUri(config);
    } catch {
      /* use config.url */
    }
    const path = normalizeApiPath(requestUrl);
    if (method === "post" && path === "/profile/cv") {
      const uploadFile = extractUploadFile(config.data);
      config.adapter = async () => {
        const data = await handleDemoCvUpload(uploadFile);
        return {
          data,
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      };
      return config;
    }
  }

  // Known dev invite codes (123456 / 654321) — works even when the backend store is empty.
  if (!config.adapter && process.env.NODE_ENV === "development") {
    const inviteMock = getInviteDevResponse(config);
    if (inviteMock !== undefined) {
      config.adapter = () => Promise.resolve({
        data: inviteMock,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
      return config;
    }
  }

  // Finance demo must win over the real API (and over generic demoMode jobs).
  if (!config.adapter && isFinanceDemoEnabled()) {
    const financeDemoMock = getFinanceDemoResponse(config);
    if (financeDemoMock !== undefined) {
      config.adapter = () => Promise.resolve({
        data: financeDemoMock,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
      return config;
    }
  }

  // Demo-account swipes (tutorial / creator demo) — never call real apply generation.
  if (!config.adapter && isDemoAccountEnabled()) {
    const demoSwipeMock = getDemoAccountResponse(config);
    if (demoSwipeMock !== undefined) {
      config.adapter = () => Promise.resolve({
        data: demoSwipeMock,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
      return config;
    }
  }

  if (demoMode && !config.adapter) {
    const method = (config.method || "get").toLowerCase();
    let requestUrl = config.url || "";
    try {
      requestUrl = axios.getUri(config);
    } catch {
      /* use config.url */
    }
    const path = normalizeApiPath(requestUrl);
    const hasSession = Boolean(getSessionToken());
    // Keep real account identity when logged in — only mock data routes without a session.
    const skipAuthMeMock = hasSession && method === "get" && path === "/auth/me";
    if (!skipAuthMeMock) {
      const mock = getDemoResponse(config);
      if (mock !== undefined) {
        config.adapter = () => Promise.resolve({
          data: mock,
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        });
      }
    }
  }

  if (!config.adapter) {
    const demoAccountMock = getDemoAccountResponse(config);
    if (demoAccountMock !== undefined) {
      config.adapter = () => Promise.resolve({
        data: demoAccountMock,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
    }
  }

  return config;
});

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  let path = "";
  try {
    path = normalizeApiPath(axios.getUri(config));
  } catch {
    path = normalizeApiPath(config.url || "");
  }
  if (path.startsWith("/admin")) {
    config.timeout = Math.max(config.timeout || 0, 60000);
  }
  if (method === "post") {
    let path = "";
    try {
      path = normalizeApiPath(axios.getUri(config));
    } catch {
      path = normalizeApiPath(config.url || "");
    }
    if (path === "/profile/cv" && !config.adapter) {
      config.timeout = Math.max(config.timeout || 0, 120000);
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => patchFinanceDemoResponse(patchDemoAccountResponse(response)),
  (error) => Promise.reject(error),
);
