import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";

export default function ProtectedRoute({ children, requireProfile = false }) {
  const { user, hasProfile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" data-testid="protected-loading">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (requireProfile && !hasProfile) return <Navigate to="/onboarding" replace />;
  return children;
}
