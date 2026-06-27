import { api, setSessionToken } from "./api";
import { supabase, supabaseConfigured } from "./supabase";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function supabaseSessionPayload(session) {
  const identityData = session?.user?.identities?.[0]?.identity_data || {};
  return {
    access_token: session?.access_token || "",
    provider_token: session?.provider_token || "",
    provider_refresh_token: session?.provider_refresh_token || identityData.provider_refresh_token || identityData.refresh_token || "",
    provider_token_expires_at: session?.expires_at || null,
  };
}

/** Start auth and return to the requested app path after login.
 * @param {string} returnPath - App path to redirect to after successful login.
 * @param {{ login_hint?: string }} [opts] - Optional OAuth hints (e.g. email pre-fill).
 */
export async function startGoogleLogin(returnPath = "/swipe", opts = {}) {
  const path = returnPath && returnPath.startsWith("/") ? returnPath : "/swipe";
  sessionStorage.setItem("swiipr_onboarding_return", path);
  setSessionToken(null);

  const devLoginEnabled = process.env.REACT_APP_DEV_LOGIN_ENABLED === "true";
  if (devLoginEnabled) {
    try {
      const { data } = await api.post("/dev/login");
      const token = data?.session_token || data?.token;
      if (token) {
        setSessionToken(token);
        window.location.href = path;
        return true;
      }
    } catch (error) {
      console.warn("Dev login unavailable, falling back to hosted auth.");
    }
  }

  if (!supabaseConfigured || !supabase) {
    console.error("Supabase auth is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.");
    return false;
  }

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}`;
  const queryParams = {
    access_type: "offline",
    prompt: "consent",
    ...(opts.login_hint ? { login_hint: opts.login_hint } : {}),
  };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: `openid email profile ${GMAIL_READONLY_SCOPE}`,
      queryParams,
    },
  });
  if (error) {
    console.error("Supabase Google login failed.", error);
    return false;
  }
  return true;
}
