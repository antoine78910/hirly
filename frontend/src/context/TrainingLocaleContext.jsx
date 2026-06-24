import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { trainingT } from "../lib/trainingUi";
import { isTrainingLocale } from "../lib/trainingRoutes";

const STORAGE_KEY = "hirly_training_lang";

const TrainingLocaleContext = createContext(null);

export function TrainingLocaleProvider({ initialLang, children }) {
  const resolved = isTrainingLocale(initialLang) ? initialLang : "fr";
  const [lang, setLangState] = useState(resolved);

  useEffect(() => {
    const next = isTrainingLocale(initialLang) ? initialLang : "fr";
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, [initialLang]);

  const setLang = useCallback((next) => {
    const value = next === "fr" ? "fr" : "en";
    localStorage.setItem(STORAGE_KEY, value);
    setLangState(value);
  }, []);

  const t = useCallback((key, vars) => trainingT(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

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
