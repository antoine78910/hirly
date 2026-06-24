import { api, setSessionToken } from "./api";
import { supabase, supabaseConfigured } from "./supabase";

/** Start auth and return to the requested app path after login.
 * @param {string} returnPath - App path to redirect to after successful login.
 * @param {{ login_hint?: string }} [opts] - Optional OAuth hints (e.g. email pre-fill).
 */
export async function startGoogleLogin(returnPath = "/swipe", opts = {}) {
  const path = returnPath && returnPath.startsWith("/") ? returnPath : "/swipe";
  if (path.startsWith("/onboarding")) {
    sessionStorage.setItem("swiipr_onboarding_return", path);
  }

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
  const queryParams = opts.login_hint ? { login_hint: opts.login_hint } : undefined;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, ...(queryParams ? { queryParams } : {}) },
  });
  if (error) {
    console.error("Supabase Google login failed.", error);
    return false;
  }
  return true;
}
