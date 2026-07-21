import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { devBypassAuth } from "../../lib/dev";

/** Keep in sync with TrainingAccessGate and backend TRAINING_OPEN_ACCESS. */
const TRAINING_OPEN_ACCESS = (process.env.REACT_APP_TRAINING_OPEN_ACCESS ?? "true").toLowerCase() !== "false";

function hasRecordToolsAccess({ user, hasTrainingAccess, isAdmin, isTrainingCreator }) {
  if (!user) return false;
  if (user.demo_account) return true;
  if (hasTrainingAccess) return true;
  if (isAdmin) return true;
  if (isTrainingCreator) return true;
  if (TRAINING_OPEN_ACCESS) return true;
  return false;
}

export default function RecordToolsAccessGate({ children }) {
  const { user, hasTrainingAccess, isAdmin, isTrainingCreator, loading } = useAuth();
  const location = useLocation();

  if (devBypassAuth) return children;

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) {
    const returnPath = `${location.pathname}${location.search}${location.hash}` || "/record-tools";
    return <Navigate to={`/signin?next=${encodeURIComponent(returnPath)}`} replace />;
  }

  if (!hasRecordToolsAccess({ user, hasTrainingAccess, isAdmin, isTrainingCreator })) {
    return <Navigate to="/training" replace />;
  }

  return children;
}
