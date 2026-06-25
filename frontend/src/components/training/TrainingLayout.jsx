import { Navigate, useLocation, useParams } from "react-router-dom";
import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";
import { isTrainingLocale, trainingPath } from "../../lib/trainingRoutes";

export default function TrainingLayout({ children }) {
  const { locale } = useParams();
  const location = useLocation();

  if (locale === "en") {
    return (
      <Navigate
        to={`${location.pathname.replace(/^\/en\//, "/fr/")}${location.search}`}
        replace
      />
    );
  }

  if (!isTrainingLocale(locale)) {
    return <Navigate to={trainingPath("fr")} replace />;
  }

  return <TrainingLocaleProvider>{children}</TrainingLocaleProvider>;
}
