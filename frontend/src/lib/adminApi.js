import { getDirectApiBase } from "./api";

/** Absolute Railway API URL in prod; relative path locally (axios baseURL). */
export function autoApplyApiUrl(path) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const base = (getDirectApiBase() || "").replace(/\/+$/, "");
  if (!base || base === "/api" || !/^https?:\/\//i.test(base)) {
    return clean;
  }
  return `${base}${clean}`;
}

export function isTransientNetworkError(err) {
  if (err?.response) return false;
  // Timeouts (ECONNABORTED) are NOT blips — retrying them just stacks waits.
  if (err?.code === "ERR_NETWORK") return true;
  const msg = String(err?.message || "");
  return /network error|failed to fetch|load failed/i.test(msg);
}

export function isRequestTimeoutError(err) {
  if (err?.response) return false;
  if (err?.code === "ECONNABORTED") return true;
  return /timeout/i.test(String(err?.message || ""));
}

/**
 * Retry a request on brief network blips (Railway/Vercel deploy restarts).
 * Does not retry HTTP error responses.
 */
export async function withNetworkRetries(fn, { attempts = 3, delayMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/** Map axios errors from admin API calls to user-facing messages. */
export function adminApiErrorMessage(err, fallback) {
  if (!err?.response) {
    if (err?.code === "POLL_DEADLINE") {
      return String(err.message || fallback || "Auto-apply is still running.");
    }
    const rawMsg = String(err?.message || "");
    if (/ReadTimeout|ConnectTimeout/i.test(rawMsg)) {
      return (
        "Database/API timed out (Supabase ReadTimeout). " +
        "Retry in a few seconds — often overload, not Bright Data."
      );
    }
    if (err?.code === "ECONNABORTED" || /timeout/i.test(rawMsg)) {
      return (
        `${fallback || "The admin request"} timed out. ` +
        "Refresh and retry; if it continues, check Railway or Supabase health."
      );
    }
    const networkMsg = String(err?.message || "").trim();
    if (networkMsg && networkMsg !== "Network Error") {
      return networkMsg;
    }
    if (process.env.NODE_ENV === "development") {
      return "Could not reach the API server. Start the backend (port 8001) and refresh.";
    }
    return (
      "Could not reach the API (network blip or deploy restart). " +
      "Auto-apply now calls Railway directly — wait a few seconds and retry. " +
      "If it keeps failing, check Railway logs."
    );
  }

  const status = err.response.status;
  const data = err.response?.data;

  if (status === 502 || status === 504) {
    return (
      `Gateway timeout (${status}): Railway likely killed the long browser/proxy run. ` +
      "Retry, or check BROWSER_PROXY / Railway logs."
    );
  }
  if (status === 503) {
    return `Service unavailable (${status}). The backend may be restarting — retry in a moment.`;
  }

  // Soft ExecutionReport sometimes nested under result when a proxy strips status codes oddly.
  const nested =
    data?.result?.error?.message || data?.result?.reason || data?.error?.message || data?.message;
  if (typeof nested === "string" && nested.trim()) return nested.trim();

  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    const trimmed = detail.trim();
    if (trimmed === "Internal Server Error" || /^internal server error$/i.test(trimmed)) {
      return (
        "Server error (500) while starting or polling auto-apply. " +
        "Often a deploy restart or an oversized status payload — retry in a moment, " +
        "or check Railway logs."
      );
    }
    return trimmed;
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const message = detail.message || detail.detail;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => item?.msg || String(item)).join(", ");
  }

  if (typeof data === "string" && data.trim()) {
    if (data.includes("<html") || data.includes("<!DOCTYPE")) {
      return `Server error (${status}): non-JSON gateway response. Check Railway logs.`;
    }
    return data.trim().slice(0, 300);
  }

  if (status >= 500) {
    return `Server error (${status}). ${fallback || "Check Railway logs for the stack trace."}`;
  }
  if (status >= 400) {
    return fallback || `Request failed (${status}).`;
  }
  return fallback || "Request failed.";
}

/** Build a console-ready ExecutionReport when the HTTP call itself fails. */
export function syntheticAutoApplyErrorReport(err, fallbackMessage) {
  const detail = err?.response?.data?.detail;
  const nestedResult = err?.response?.data?.result;
  if (
    nestedResult &&
    typeof nestedResult === "object" &&
    (nestedResult.error || nestedResult.status)
  ) {
    return nestedResult;
  }

  const status = err?.response?.status || null;
  const pollDeadline = err?.code === "POLL_DEADLINE";
  const timedOut =
    !pollDeadline && (err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message || "")));
  const message = adminApiErrorMessage(err, fallbackMessage || "Execution failed");

  let phase = "execute";
  let stage = "driver";
  let errorPayload;

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    errorPayload = { ...detail, message: detail.message || message };
    phase = detail.phase || phase;
    if (phase === "open_browser" || phase === "open_page") stage = "submit";
  } else {
    errorPayload = {
      message,
      phase,
      http_status: status,
      timed_out: timedOut || pollDeadline,
      exception_class: pollDeadline
        ? "PollDeadline"
        : timedOut
          ? "Timeout"
          : status
            ? `HTTP${status}`
            : "NetworkError",
      hint:
        timedOut || pollDeadline || status === 502 || status === 504
          ? "Long browser runs with proxy retries can exceed the gateway limit. Retry, or check Railway logs."
          : undefined,
    };
  }

  return {
    stage_reached: stage,
    status: "error",
    reason: message,
    error: errorPayload,
    debug: {
      error: errorPayload,
      timeline: [
        {
          stage,
          status: "error",
          detail: message,
        },
      ],
    },
  };
}
