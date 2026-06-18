import axios from "axios";
import { demoMode } from "./dev";
import { getDemoResponse } from "./demoApi";
import { getDemoAccountResponse, patchDemoAccountResponse } from "./demoAccount";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL
  || (process.env.NODE_ENV === "development" ? "http://localhost:8001" : "");
export const API = `${BACKEND_URL}/api`;

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

  if (demoMode) {
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
