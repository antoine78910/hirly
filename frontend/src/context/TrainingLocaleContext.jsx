import { createContext, useCallback, useContext, useMemo } from "react";
import { trainingT } from "../lib/trainingUi";

const TrainingLocaleContext = createContext(null);

/** Training academy is French-only. */
export function TrainingLocaleProvider({ children }) {
  const lang = "fr";

  const setLang = useCallback(() => {}, []);

  const t = useCallback((key, vars) => trainingT(lang, key, vars), []);

  const value = useMemo(() => ({ lang, setLang, t }), [setLang, t]);

  return (
    <TrainingLocaleContext.Provider value={value}>
      {children}
    </TrainingLocaleContext.Provider>
  );
}

export function useTrainingLocale() {
  const ctx = useContext(TrainingLocaleContext);
  if (!ctx) {
    throw new Error("useTrainingLocale must be used within TrainingLocaleProvider");
  }
  return ctx;
}
