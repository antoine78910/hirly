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
 * @param {{ login_hint?: string, prompt?: string }} [opts] - Optional OAuth hints.
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
    ...(opts.login_hint ? { login_hint: opts.login_hint } : {}),
    ...(opts.prompt ? { prompt: opts.prompt } : {}),
  };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, ...(Object.keys(queryParams).length ? { queryParams } : {}) },
  });
  if (error) {
    console.error("Supabase Google login failed.", error);
    return false;
  }
  return true;
}

export function authCallbackRedirectUrl(returnPath = "/swipe") {
  const path = returnPath && returnPath.startsWith("/") ? returnPath : "/swipe";
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}`;
}

/** Exchange a Supabase session for an app session. Returns null when email confirmation is still pending. */
export async function establishAppSessionFromSupabase(session) {
  const accessToken = session?.access_token;
  if (!accessToken) return null;
  const { data } = await api.post("/auth/supabase-session", supabaseSessionPayload(session));
  if (data?.session_token) setSessionToken(data.session_token);
  return data;
}
