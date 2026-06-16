import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";
import { storedTrainingLocale } from "../../lib/trainingRoutes";

/** Training pages at /training (no /en|/fr prefix) — locale from storage, default en. */
export default function TrainingLayoutDefault({ children }) {
  return (
    <TrainingLocaleProvider initialLang={storedTrainingLocale()}>
      {children}
    </TrainingLocaleProvider>
  );
}
