import { useParams } from "react-router-dom";
import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";
import { hasTrainingContent, isTrainingLocale } from "../../lib/trainingRoutes";
import TrainingLocaleUnavailable from "./TrainingLocaleUnavailable";

export default function TrainingLayout({ children }) {
  const { locale } = useParams();

  if (!isTrainingLocale(locale)) {
    return <TrainingLocaleUnavailable />;
  }

  if (!hasTrainingContent(locale)) return <TrainingLocaleUnavailable />;

  return <TrainingLocaleProvider locale={locale}>{children}</TrainingLocaleProvider>;
}
