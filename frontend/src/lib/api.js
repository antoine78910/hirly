import axios from "axios";
import { demoMode } from "./dev";
import { getDemoResponse } from "./demoApi";
import { getFinanceDemoResponse } from "./financeDemoApi";
import { getDemoAccountResponse, patchDemoAccountResponse } from "./demoAccount";
import { isFinanceDemoEnabled } from "./demoSettings";

const normalizeBackendUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "").replace(/\/api$/i, "");
};

const BACKEND_URL = normalizeBackendUrl(
  process.env.REACT_APP_BACKEND_URL
    || (process.env.NODE_ENV === "development" ? "http://localhost:8001" : ""),
);
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

/** Resolve API-relative media paths (e.g. uploaded training videos). */
export function resolveApiAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = (BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
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

api.interceptors.response.use(
  (response) => patchDemoAccountResponse(response),
  (error) => Promise.reject(error),
);
