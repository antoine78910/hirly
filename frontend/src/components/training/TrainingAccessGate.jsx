import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { devBypassAuth } from "../../lib/dev";
import { api } from "../../lib/api";
import ProtectedRoute from "../ProtectedRoute";
import TrainingAccessDenied from "./TrainingAccessDenied";

export default function TrainingAccessGate({ children }) {
  const { user, loading: authLoading, hasTrainingAccess, setHasTrainingAccess } = useAuth();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(devBypassAuth);

  useEffect(() => {
    if (devBypassAuth) {
      setAllowed(true);
      setChecking(false);
      return;
    }
    if (authLoading) return;

    if (!user) {
      setAllowed(false);
      setChecking(false);
      return;
    }

    if (hasTrainingAccess) {
      setAllowed(true);
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/training/access");
        if (cancelled) return;
        const next = Boolean(data?.has_access);
        setHasTrainingAccess(next);
        setAllowed(next);
      } catch {
        if (!cancelled) setAllowed(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, hasTrainingAccess, setHasTrainingAccess, user]);

  if (devBypassAuth) return children;

  return (
    <ProtectedRoute>
      {authLoading || checking ? (
        <div className="grid min-h-dvh place-items-center bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : allowed ? (
        children
      ) : (
        <TrainingAccessDenied />
      )}
    </ProtectedRoute>
  );
}
