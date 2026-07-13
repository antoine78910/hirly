// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSessionToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { resolveSupabaseAuthSession, supabaseSessionPayload } from "../lib/auth";
import { trackEvent } from "../lib/analytics";
import { trackOnboardingSignup } from "../lib/datafast";
import {
  applyRedeemToAuth,
  clearPendingInviteCode,
  inviteDestination,
  shouldAutoRedeemPendingInvite,
  tryRedeemPendingInvite,
} from "../lib/creatorInvite";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import { resolvePostAuthDestination } from "../lib/appDomains";
import {
  clearOnboardingReturnPath,
  readOnboardingReturnPath,
  splitAppPath,
} from "../lib/auth";
import { hasJobSeekerOnboardingComplete } from "../lib/jobSeekerEntry";

export default function AuthCallback() {
  const navigate = useNavigate();
  const {
    setUser,
    setHasProfile,
    setHasPreferences,
    setIsTrainingCreator,
    setHasTrainingAccess,
    checkAuth,
  } = useAuth();
  const hasProcessed = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const params = new URLSearchParams(window.location.search);
    const storedReturn = readOnboardingReturnPath();
    const nextPath = params.get("next") || storedReturn || "/swipe";

    (async () => {
      let step = "init";
      try {
        step = "supabase_config";
        if (!supabaseConfigured || !supabase) throw new Error("Supabase auth is not configured");
        step = "supabase_exchange";
        const session = await resolveSupabaseAuthSession(supabase);
        const accessToken = session?.access_token;
        if (!accessToken) {
          throw new Error(
            "Email verification session not found. Open the link in the same browser where you signed up, or request a new verification email.",
          );
        }
        step = "backend_session";
        const response = await api.post("/auth/supabase-session", supabaseSessionPayload(session));
        const data = response.data;
        if (data?.session_token) setSessionToken(data.session_token);
        setUser(data.user);
        setHasProfile(Boolean(data.has_profile));
        setHasPreferences(Boolean(data.has_preferences));
        setIsTrainingCreator(Boolean(data.is_training_creator));
        setHasTrainingAccess(Boolean(data.has_training_access));
        setDemoAccountFromUser(data.user, Boolean(data.is_admin));
        let inviteRedirect = null;
        let redeemed = null;
        const autoRedeemInvite = shouldAutoRedeemPendingInvite(nextPath, storedReturn);
        if (autoRedeemInvite) {
          try {
            redeemed = await tryRedeemPendingInvite(api);
            if (redeemed) {
              applyRedeemToAuth(redeemed, data?.user, {
                setUser,
                setHasTrainingAccess,
                setDemoAccountFromUser,
                setHasProfile,
                setHasPreferences,
              });
              inviteRedirect = inviteDestination(redeemed);
            }
          } catch (inviteErr) {
            console.warn("Invite redeem skipped", inviteErr?.response?.data?.detail || inviteErr?.message);
          }
        } else {
          clearPendingInviteCode();
        }
        const authProvider = session?.user?.app_metadata?.provider
          || session?.user?.identities?.[0]?.provider
          || "email";
        trackEvent("auth_success", {
          method: authProvider === "google" ? "google" : "email",
          has_profile: Boolean(data.has_profile),
          has_preferences: Boolean(data.has_preferences),
        });
        const onboardingSignupReturn = Boolean(
          storedReturn?.includes("/onboarding") || nextPath.includes("/onboarding"),
        );
        if (onboardingSignupReturn && authProvider === "google") {
          trackOnboardingSignup("google");
        }
        if (onboardingSignupReturn && authProvider === "email") {
          trackOnboardingSignup("email");
        }
        clearOnboardingReturnPath();

        window.history.replaceState({}, "", window.location.pathname);
        const onboardingIncomplete = !data.has_profile || !data.has_preferences;
        const isDemoOrTrainingInvite = Boolean(redeemed?.demo_account || redeemed?.training_access);
        let destination = inviteRedirect || (nextPath.startsWith("/") ? nextPath : "/swipe");
        // Google/email signup from onboarding must continue onboarding — never skip via billing.
        if (
          !inviteRedirect
          && (onboardingIncomplete || onboardingSignupReturn)
          && !isDemoOrTrainingInvite
          && !data?.user?.demo_account
        ) {
          destination = destination.startsWith("/onboarding")
            ? destination
            : "/onboarding?step=jobSearch";
        } else if (
          !inviteRedirect
          && destination.startsWith("/onboarding")
          && !isDemoOrTrainingInvite
          && !data?.user?.demo_account
        ) {
          try {
            const { data: profileData } = await api.get("/profile");
            if (hasJobSeekerOnboardingComplete(profileData)) {
              destination = "/swipe";
            }
          } catch {
            /* keep onboarding destination */
          }
        }
        if (checkAuth) {
          await checkAuth();
        }
        const { pathname, search } = splitAppPath(destination);
        const resolved = resolvePostAuthDestination(pathname, search);
        if (resolved.type === "external") {
          window.location.replace(resolved.url);
          return;
        }
        navigate(resolved.path, { replace: true });
      } catch (e) {
        console.error("Auth callback failed", e);
        const detail = e?.response?.data?.detail || e?.message || "Unknown auth callback error";
        const message = typeof detail === "string" ? detail : JSON.stringify(detail);
        setErrorMessage(`${step}: ${message}`);
      }
    })();
  }, [navigate, setUser, setHasProfile, setHasPreferences, setIsTrainingCreator, setHasTrainingAccess, checkAuth]);

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
