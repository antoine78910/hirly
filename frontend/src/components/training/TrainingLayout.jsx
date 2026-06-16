import { Navigate, useParams } from "react-router-dom";
import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";
import { isTrainingLocale, storedTrainingLocale, trainingPath } from "../../lib/trainingRoutes";

export default function TrainingLayout({ children }) {
  const { locale } = useParams();

  if (!isTrainingLocale(locale)) {
    return <Navigate to={trainingPath(storedTrainingLocale())} replace />;
  }

  return (
    <TrainingLocaleProvider initialLang={locale}>
      {children}
    </TrainingLocaleProvider>
  );
}
