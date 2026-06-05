// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSessionToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";

function returnPathAfterAuth() {
  const path = `${window.location.pathname}${window.location.search}`;
  return path && path !== "/" ? path : "/swipe";
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, setHasProfile, setHasPreferences } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const sessionIdMatch = hash.match(/session_id=([^&]+)/);
    const sessionTokenMatch = hash.match(/session_token=([^&]+)/);
    const returnPath = returnPathAfterAuth();

    if (!sessionIdMatch && !sessionTokenMatch) {
      navigate("/", { replace: true });
      return;
    }

    (async () => {
      try {
        if (sessionTokenMatch) {
          const session_token = decodeURIComponent(sessionTokenMatch[1]);
          setSessionToken(session_token);
          const { data } = await api.get("/auth/me");
          setUser(data.user);
          setHasProfile(data.has_profile);
          setHasPreferences(data.has_preferences);
          window.history.replaceState({}, "", returnPath);

          if (!data.has_profile) {
            const onboardingPath = returnPath.includes("onboarding")
              ? returnPath
              : "/onboarding?step=jobSearch";
            navigate(onboardingPath, { replace: true });
          } else {
            navigate(returnPath, { replace: true });
          }
          return;
        }

        const session_id = decodeURIComponent(sessionIdMatch[1]);
        const { data } = await api.post("/auth/session", { session_id });
        if (data?.session_token) setSessionToken(data.session_token);
        setUser(data.user);
        setHasProfile(data.has_profile);
        setHasPreferences(false);

        window.history.replaceState({}, "", window.location.pathname);
        if (!data.has_profile) navigate("/onboarding?step=jobSearch", { replace: true });
        else navigate("/swipe", { replace: true });
      } catch (e) {
        console.error("Auth callback failed", e);
        navigate("/", { replace: true });
      }
    })();
  }, [navigate, setUser, setHasProfile, setHasPreferences]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-white" data-testid="auth-callback">
      <div className="flex flex-col items-center gap-3 text-zinc-600">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
