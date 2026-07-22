import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { isDemoAccountEnabled } from "../lib/demoAccount";
import { devBypassAuth } from "../lib/dev";
import { domainSplitEnabled, isAppHost, marketingUrl } from "../lib/appDomains";
import { fetchJobSeekerProfile, hasJobSeekerOnboardingComplete } from "../lib/jobSeekerEntry";

// Guards against a cross-domain auth redirect loop (app.tryhirly.com <->
// tryhirly.com/signin): if we land back here within this window of our own
// last redirect attempt, something is preventing auth from being recognized
// across domains -- stop bouncing (which otherwise makes the whole app
// unusable) and show a manual way forward instead of flickering forever.
const AUTH_REDIRECT_GUARD_KEY = "hirly_auth_redirect_guard_at";
const AUTH_REDIRECT_GUARD_WINDOW_MS = 6000;

export default function ProtectedRoute({ children, requireProfile = false }) {
  const { user, hasProfile, hasPreferences, hasTrainingAccess, loading } = useAuth();
  const location = useLocation();
  const loginRedirectStartedRef = useRef(false);
  const [redirectLoopDetected, setRedirectLoopDetected] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(null);

  const isCreator =
    Boolean(user?.demo_account) || Boolean(hasTrainingAccess) || isDemoAccountEnabled();
  const profileReady = Boolean(hasProfile && hasPreferences);

  useEffect(() => {
    if (devBypassAuth || loading || !user || !requireProfile || isCreator || profileReady) {
      setOnboardingComplete(null);
      return;
    }
    if (!hasProfile) {
      setOnboardingComplete(false);
      return;
    }

    let cancelled = false;
    setOnboardingComplete(null);
    (async () => {
      try {
        const profile = await fetchJobSeekerProfile();
        if (!cancelled) setOnboardingComplete(hasJobSeekerOnboardingComplete(profile));
      } catch {
        if (!cancelled) setOnboardingComplete(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, requireProfile, isCreator, hasProfile, hasPreferences, profileReady]);

  useEffect(() => {
    if (devBypassAuth || loading || user) return;
    if (!domainSplitEnabled() || !isAppHost()) return;
    if (loginRedirectStartedRef.current) return;
    loginRedirectStartedRef.current = true;

    let lastAttempt = 0;
    try {
      lastAttempt = Number(sessionStorage.getItem(AUTH_REDIRECT_GUARD_KEY) || 0);
    } catch (_) {
      /* ignore */
    }
    if (lastAttempt && Date.now() - lastAttempt < AUTH_REDIRECT_GUARD_WINDOW_MS) {
      setRedirectLoopDetected(true);
      return;
    }
    try {
      sessionStorage.setItem(AUTH_REDIRECT_GUARD_KEY, String(Date.now()));
    } catch (_) {
      /* ignore */
    }

    const returnPath = `${location.pathname}${location.search}${location.hash}` || "/swipe";
    window.location.replace(marketingUrl(`/signin?next=${encodeURIComponent(returnPath)}`));
  }, [loading, user, location.pathname, location.search, location.hash]);

  if (devBypassAuth) return children;

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" data-testid="protected-loading">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }
  if (!user) {
    if (domainSplitEnabled() && isAppHost()) {
      if (redirectLoopDetected) {
        const returnPath = `${location.pathname}${location.search}${location.hash}` || "/swipe";
        return (
          <div
            className="min-h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center"
            data-testid="protected-redirect-loop"
          >
            <p className="text-sm text-zinc-500">Having trouble verifying your session.</p>
            <a
              href={marketingUrl(`/signin?next=${encodeURIComponent(returnPath)}`)}
              className="text-sm font-semibold text-linkedin underline"
            >
              Tap here to sign in
            </a>
          </div>
        );
      }
      return (
        <div className="min-h-dvh flex items-center justify-center" data-testid="protected-loading">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      );
    }
    const returnPath = `${location.pathname}${location.search}${location.hash}` || "/swipe";
    return <Navigate to={`/signin?next=${encodeURIComponent(returnPath)}`} replace />;
  }
  // Demo and training creators bypass the job-seeker profile requirement.
  if (requireProfile && !isCreator) {
    if (!hasProfile) {
      if (domainSplitEnabled() && isAppHost()) {
        window.location.replace(marketingUrl("/onboarding"));
        return null;
      }
      return <Navigate to="/onboarding" replace />;
    }
    if (!hasPreferences) {
      if (onboardingComplete === null) {
        return (
          <div
            className="min-h-dvh flex items-center justify-center"
            data-testid="protected-profile-loading"
          >
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          </div>
        );
      }
      if (!onboardingComplete) {
        if (domainSplitEnabled() && isAppHost()) {
          window.location.replace(marketingUrl("/onboarding"));
          return null;
        }
        return <Navigate to="/onboarding" replace />;
      }
    }
  }
  return children;
}
