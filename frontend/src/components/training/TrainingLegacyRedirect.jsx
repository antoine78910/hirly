import { Navigate, useLocation } from "react-router-dom";
import { legacyTrainingRedirect } from "../../lib/trainingRoutes";

export default function TrainingLegacyRedirect() {
  const location = useLocation();
  return <Navigate to={legacyTrainingRedirect(location.pathname, location.search)} replace />;
}
