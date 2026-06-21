import { api, setSessionToken, getSessionToken } from "./api";
import { TUTORIAL_BYPASS_AUTH } from "./dev";

/** Bootstrap a shared demo-account session for tutorial filming (real feed, simulated applies). */
export async function bootstrapTutorialSession() {
  const { data } = await api.post("/tutorial/session");
  const token = data?.session_token || data?.token;
  if (token) setSessionToken(token);
  return data;
}

/** Ensure tutorial mode has a valid backend session before hitting protected routes. */
export async function ensureTutorialSession() {
  if (!TUTORIAL_BYPASS_AUTH) return null;

  const existing = getSessionToken();
  if (existing) {
    try {
      await api.get("/auth/me");
      return existing;
    } catch {
      setSessionToken(null);
    }
  }

  const data = await bootstrapTutorialSession();
  return data?.session_token || data?.token || null;
}
