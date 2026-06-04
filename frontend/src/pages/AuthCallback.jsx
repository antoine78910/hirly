// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSessionToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, setHasProfile, setHasPreferences } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/", { replace: true });
      return;
    }
    const session_id = decodeURIComponent(match[1]);

    (async () => {
      try {
        const { data } = await api.post("/auth/session", { session_id });
        if (data?.session_token) setSessionToken(data.session_token);
        setUser(data.user);
        setHasProfile(data.has_profile);
        setHasPreferences(false);

        // Clear hash and route to next step
        window.history.replaceState({}, "", window.location.pathname);
        if (!data.has_profile) navigate("/onboarding", { replace: true });
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
