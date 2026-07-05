import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { devBypassAuth } from "../lib/dev";
import {
  domainSplitEnabled,
  isAppHost,
  marketingUrl,
  appUrl,
} from "../lib/appDomains";

export default function ProtectedRoute({ children, requireProfile = false }) {
  const { user, hasProfile, hasPreferences, hasTrainingAccess, loading } = useAuth();
  const location = useLocation();

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
      const redirectTarget = encodeURIComponent(appUrl(location.pathname, location.search, location.hash));
      window.location.replace(marketingUrl("/", `?redirect=${redirectTarget}`));
      return null;
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
