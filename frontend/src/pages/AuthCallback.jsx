// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSessionToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { trackEvent } from "../lib/analytics";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, setHasProfile, setHasPreferences, setIsTrainingCreator } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const params = new URLSearchParams(window.location.search);
    const storedReturn = sessionStorage.getItem("swiipr_onboarding_return");
    const nextPath = params.get("next") || storedReturn || "/swipe";

    (async () => {
      try {
        if (!supabaseConfigured || !supabase) throw new Error("Supabase auth is not configured");
        const code = params.get("code");
        const { data: sessionData, error } = code
          ? await supabase.auth.exchangeCodeForSession(code)
          : await supabase.auth.getSession();
        if (error) throw error;
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) throw new Error("Supabase session not found");
        const response = await api.post("/auth/supabase-session", { access_token: accessToken });
        const data = response.data;
        if (data?.session_token) setSessionToken(data.session_token);
        setUser(data.user);
        setHasProfile(Boolean(data.has_profile));
        setHasPreferences(Boolean(data.has_preferences));
        setIsTrainingCreator(Boolean(data.is_training_creator));
        trackEvent("auth_success", {
          method: "google",
          has_profile: Boolean(data.has_profile),
          has_preferences: Boolean(data.has_preferences),
        });
        sessionStorage.removeItem("swiipr_onboarding_return");

        window.history.replaceState({}, "", window.location.pathname);
        const onboardingIncomplete = !data.has_profile || !data.has_preferences;
        let destination = nextPath.startsWith("/") ? nextPath : "/swipe";
        if (onboardingIncomplete) {
          destination = destination.startsWith("/onboarding")
            ? destination
            : "/onboarding?step=jobSearch";
        } else if (destination.startsWith("/onboarding")) {
          destination = "/swipe";
        }
        navigate(destination, { replace: true });
      } catch (e) {
        console.error("Auth callback failed", e);
        navigate("/", { replace: true });
      }
    })();
  }, [navigate, setUser, setHasProfile, setHasPreferences, setIsTrainingCreator]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-white" data-testid="auth-callback">
      <div className="flex flex-col items-center gap-3 text-zinc-600">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
