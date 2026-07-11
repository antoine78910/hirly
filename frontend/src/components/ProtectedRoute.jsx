import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { devBypassAuth } from "../lib/dev";
import {
  domainSplitEnabled,
  isAppHost,
  marketingUrl,
} from "../lib/appDomains";

export default function ProtectedRoute({ children, requireProfile = false }) {
  const { user, hasProfile, hasPreferences, hasTrainingAccess, loading } = useAuth();
  const location = useLocation();
  const loginRedirectStartedRef = useRef(false);

  useEffect(() => {
    if (devBypassAuth || loading || user) return;
    if (!domainSplitEnabled() || !isAppHost()) return;
    if (loginRedirectStartedRef.current) return;
    loginRedirectStartedRef.current = true;
    const returnPath = `${location.pathname}${location.search}${location.hash}` || "/swipe";
    window.location.replace(
      marketingUrl(`/signin?next=${encodeURIComponent(returnPath)}`),
    );
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
    const returnPath = `${location.pathname}${location.search}${location.hash}` || "/swipe";
    return (
      <Navigate
        to={`/signin?next=${encodeURIComponent(returnPath)}`}
        replace
      />
    );
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
