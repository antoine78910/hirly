import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { devBypassAuth } from "../../lib/dev";

export default function RecordToolsAccessGate({ children }) {
  const { user, hasTrainingAccess, loading } = useAuth();
  const [allowed, setAllowed] = useState(devBypassAuth);

  const isCreator = useMemo(() => Boolean(user?.demo_account) || Boolean(hasTrainingAccess), [user, hasTrainingAccess]);

  useEffect(() => {
    if (devBypassAuth) {
      setAllowed(true);
      return;
    }
    setAllowed(isCreator);
  }, [isCreator]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/training" replace />;
  }

  return children;
}

