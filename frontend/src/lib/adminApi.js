/** Map axios errors from admin API calls to user-facing messages. */
export function adminApiErrorMessage(err, fallback) {
  if (!err?.response) {
    if (err?.code === "ECONNABORTED") {
      return "Request timed out. Make sure the API server is running.";
    }
    return "Could not reach the API server. Start the backend (port 8001) and refresh.";
  }
  const detail = err.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => item?.msg || String(item)).join(", ");
  }
  return fallback;
}
