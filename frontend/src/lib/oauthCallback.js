/** Supabase may land OAuth params on Site URL (/) when redirect URL is not whitelisted. */
export function needsOAuthCallbackRedirect({ pathname, search, hash }) {
  if (pathname === '/reset-password') return false;
  if (pathname === "/auth/callback") return false;

  const params = new URLSearchParams(search);
  if (params.has("code") || params.has("error")) return true;

  if (hash && /(?:^#|[&#])(?:access_token|error)=/.test(hash)) return true;

  return false;
}

export function isOAuthCallbackInProgress(location = window.location) {
  if (location.pathname === "/auth/callback") return true;
  return needsOAuthCallbackRedirect(location);
}
