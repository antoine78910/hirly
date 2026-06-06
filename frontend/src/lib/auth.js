import { api, setSessionToken } from "./api";
import { supabase, supabaseConfigured } from "./supabase";

/** Start auth and return to the requested app path after login. */
export async function startGoogleLogin(returnPath = "/swipe") {
  const path = returnPath && returnPath.startsWith("/") ? returnPath : "/swipe";

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
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) {
    console.error("Supabase Google login failed.", error);
    return false;
  }
  return true;
}
