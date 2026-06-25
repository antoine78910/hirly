import axios from "axios";
import { demoMode } from "./dev";
import { getDemoResponse } from "./demoApi";
import { getFinanceDemoResponse, patchFinanceDemoResponse } from "./financeDemoApi";
import { getDemoAccountResponse, isDemoAccountEnabled, patchDemoAccountResponse } from "./demoAccount";
import { isFinanceDemoEnabled } from "./demoSettings";
import { handleDemoCvUpload, shouldMockCvUpload, extractUploadFile } from "./demoCvUpload";
import { normalizeApiPath } from "./apiPath";

const normalizeBackendUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "").replace(/\/api$/i, "");
};

const BACKEND_URL = normalizeBackendUrl(process.env.REACT_APP_BACKEND_URL || "");
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

/** Resolve API-relative media paths (e.g. uploaded training videos). */
export function resolveApiAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Same-origin static or proxied API paths in the browser.
  if (typeof window !== "undefined" && (normalized.startsWith("/api/") || normalized.startsWith("/training-videos/"))) {
    return normalized;
  }
  const base = (BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}${normalized}`;
}

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  timeout: 20000,
});

// Fallback: if cookies are not sent (third-party context), use bearer token
const TOKEN_KEY = "session_token";
export const setSessionToken = (t) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};
export const getSessionToken = () => localStorage.getItem(TOKEN_KEY);

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
