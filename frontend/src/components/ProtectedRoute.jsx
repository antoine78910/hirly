import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { devBypassAuth } from "../lib/dev";
import { startGoogleLogin } from "../lib/auth";
import {
  domainSplitEnabled,
  isAppHost,
  marketingUrl,
} from "../lib/appDomains";

export default function ProtectedRoute({ children, requireProfile = false }) {
  const { user, hasProfile, hasPreferences, hasTrainingAccess, loading } = useAuth();
  const location = useLocation();
  const loginStartedRef = useRef(false);

  useEffect(() => {
    if (devBypassAuth || loading || user) return;
    if (!domainSplitEnabled() || !isAppHost()) return;
    if (loginStartedRef.current) return;
    loginStartedRef.current = true;
    const returnPath = `${location.pathname}${location.search}${location.hash}` || "/swipe";
    startGoogleLogin(returnPath);
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
      return (
        <div className="min-h-dvh flex items-center justify-center" data-testid="protected-loading">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      );
    }
    return <Navigate to="/" replace />;
  }
  // Demo and training creators bypass the job-seeker profile requirement.
  const isCreator = Boolean(user?.demo_account) || Boolean(hasTrainingAccess);
  if (requireProfile && !isCreator && (!hasProfile || !hasPreferences)) {
    if (domainSplitEnabled() && isAppHost()) {
      window.location.replace(marketingUrl("/onboarding"));
      return null;
    }
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}
