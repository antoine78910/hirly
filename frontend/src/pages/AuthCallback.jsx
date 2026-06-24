// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSessionToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { trackEvent } from "../lib/analytics";
import { tryRedeemPendingInvite } from "../lib/creatorInvite";
import { setDemoAccountFromUser } from "../lib/demoAccount";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, setHasProfile, setHasPreferences, setIsTrainingCreator } = useAuth();
  const hasProcessed = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const params = new URLSearchParams(window.location.search);
    const storedReturn = sessionStorage.getItem("swiipr_onboarding_return");
    const nextPath = params.get("next") || storedReturn || "/swipe";

    (async () => {
      let step = "init";
      try {
        step = "supabase_config";
        if (!supabaseConfigured || !supabase) throw new Error("Supabase auth is not configured");
        step = "supabase_exchange";
        const code = params.get("code");
        const { data: sessionData, error } = code
          ? await supabase.auth.exchangeCodeForSession(code)
          : await supabase.auth.getSession();
        if (error) throw error;
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) throw new Error("Supabase session not found");
        step = "backend_session";
        const response = await api.post("/auth/supabase-session", { access_token: accessToken });
        const data = response.data;
        if (data?.session_token) setSessionToken(data.session_token);
        setUser(data.user);
        setHasProfile(Boolean(data.has_profile));
        setHasPreferences(Boolean(data.has_preferences));
        setIsTrainingCreator(Boolean(data.is_training_creator));
        if (data?.user?.demo_account) {
          setDemoAccountFromUser(data.user);
        }
        try {
          const redeemed = await tryRedeemPendingInvite(api);
          if (redeemed?.demo_account && data?.user) {
            const nextUser = { ...data.user, demo_account: true };
            setUser(nextUser);
            setDemoAccountFromUser(nextUser);
          }
        } catch (inviteErr) {
          console.warn("Invite redeem skipped", inviteErr?.response?.data?.detail || inviteErr?.message);
        }
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
        const detail = e?.response?.data?.detail || e?.message || "Unknown auth callback error";
        const message = typeof detail === "string" ? detail : JSON.stringify(detail);
        setErrorMessage(`${step}: ${message}`);
      }
    })();
  }, [navigate, setUser, setHasProfile, setHasPreferences, setIsTrainingCreator]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-white" data-testid="auth-callback">
      <div className="flex flex-col items-center gap-3 text-zinc-600">
        <Loader2 className="w-6 h-6 animate-spin" />
        {errorMessage ? (
          <div className="max-w-md px-6 text-center">
            <p className="text-sm font-semibold text-red-600">Sign-in failed</p>
            <p className="mt-2 break-words text-xs text-zinc-500">{errorMessage}</p>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Back to sign in
            </button>
          </div>
        ) : null}
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
