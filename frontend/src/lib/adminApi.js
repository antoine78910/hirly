/** Map axios errors from admin API calls to user-facing messages. */
export function adminApiErrorMessage(err, fallback) {
  if (!err?.response) {
    if (err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message || ""))) {
      return (
        "Request timed out waiting for the browser run "
        + "(proxy retries can take several minutes). Check Railway logs or retry."
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
      "Could not reach the server (network/CORS). "
      + "If this was a long auto-apply run, Railway may have dropped the connection — check logs and retry."
    );
  }

  const status = err.response.status;
  const data = err.response?.data;

  if (status === 502 || status === 504) {
    return (
      `Gateway timeout (${status}): Railway likely killed the long browser/proxy run. `
      + "Retry, or check BROWSER_PROXY / Railway logs."
    );
  }
  if (status === 503) {
    return `Service unavailable (${status}). The backend may be restarting — retry in a moment.`;
  }

  // Soft ExecutionReport sometimes nested under result when a proxy strips status codes oddly.
  const nested =
    data?.result?.error?.message
    || data?.result?.reason
    || data?.error?.message
    || data?.message;
  if (typeof nested === "string" && nested.trim()) return nested.trim();

  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    const trimmed = detail.trim();
    if (trimmed === "Internal Server Error" || /^internal server error$/i.test(trimmed)) {
      return (
        "Server error (500) while starting or polling auto-apply. "
        + "Often a deploy restart or an oversized status payload — retry in a moment, "
        + "or check Railway logs."
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
  if (nestedResult && typeof nestedResult === "object" && (nestedResult.error || nestedResult.status)) {
    return nestedResult;
  }

  const status = err?.response?.status || null;
  const timedOut = err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message || ""));
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
      timed_out: timedOut,
      exception_class: timedOut ? "Timeout" : (status ? `HTTP${status}` : "NetworkError"),
      hint: timedOut || status === 502 || status === 504
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
      timeline: [{
        stage,
        status: "error",
        detail: message,
      }],
    },
  };
}
