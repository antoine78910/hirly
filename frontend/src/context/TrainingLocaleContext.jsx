import { createContext, useCallback, useContext, useMemo } from "react";
import { trainingT } from "../lib/trainingUi";

const TrainingLocaleContext = createContext(null);

/** Locale is supplied by the route; only catalog-backed locales may mount this provider. */
export function TrainingLocaleProvider({ children, locale = "fr" }) {
  const lang = locale;

  const setLang = useCallback(() => {}, []);

  const t = useCallback((key, vars) => trainingT(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <TrainingLocaleContext.Provider value={value}>{children}</TrainingLocaleContext.Provider>;
}

export function useTrainingLocale() {
  const ctx = useContext(TrainingLocaleContext);
  if (!ctx) {
    throw new Error("useTrainingLocale must be used within TrainingLocaleProvider");
  }
  return ctx;
}
