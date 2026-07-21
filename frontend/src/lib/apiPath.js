/** Normalize axios config.url to an API path like `/jobs/feed`. */
export function normalizeApiPath(url = "") {
  const pathOnly = (url.split("?")[0] || "").trim();
  if (!pathOnly) return "";

  if (/^https?:\/\//i.test(pathOnly)) {
    try {
      const pathname = new URL(pathOnly).pathname || "";
      if (pathname.startsWith("/api/")) return pathname.slice(4);
      if (pathname === "/api") return "/";
      return pathname.startsWith("/") ? pathname : `/${pathname}`;
    } catch {
      return pathOnly;
    }
  }

  if (pathOnly.startsWith("/api/")) return pathOnly.slice(4);
  if (pathOnly.startsWith("api/")) return `/${pathOnly.slice(4)}`;
  return pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
}

export function parseApiPath(url = "") {
  const queryStart = url.indexOf("?");
  const query = queryStart >= 0 ? url.slice(queryStart + 1) : "";
  return {
    path: normalizeApiPath(url),
    params: Object.fromEntries(new URLSearchParams(query)),
  };
}
