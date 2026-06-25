import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";
import { devBypassAuth } from "../lib/dev";

export default function ProtectedRoute({ children, requireProfile = false }) {
  const { user, hasProfile, hasPreferences, hasTrainingAccess, loading } = useAuth();

  if (devBypassAuth) return children;

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" data-testid="protected-loading">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  // Demo and training creators bypass the job-seeker profile requirement.
  const isCreator = Boolean(user?.demo_account) || Boolean(hasTrainingAccess);
  if (requireProfile && !isCreator && (!hasProfile || !hasPreferences)) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}
