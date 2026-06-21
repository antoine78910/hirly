import { api, setSessionToken } from "./api";

/** Bootstrap a shared demo-account session for tutorial filming (real feed, simulated applies). */
export async function bootstrapTutorialSession() {
  const { data } = await api.post("/tutorial/session");
  const token = data?.session_token || data?.token;
  if (token) setSessionToken(token);
  return data;
}
