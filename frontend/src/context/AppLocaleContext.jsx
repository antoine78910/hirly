import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { appT, readStoredAppLang } from "../lib/appUi";

const STORAGE_KEY = "hirly_app_lang";

const AppLocaleContext = createContext(null);

export function AppLocaleProvider({ children }) {
  const [lang, setLangState] = useState(readStoredAppLang);

  const setLang = useCallback((next) => {
    const value = next === "fr" ? "fr" : "en";
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {}
    setLangState(value);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback((key, vars) => appT(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <AppLocaleContext.Provider value={value}>
      {children}
    </AppLocaleContext.Provider>
  );
}

export function useAppLocale() {
  const ctx = useContext(AppLocaleContext);
  if (!ctx) {
    throw new Error("useAppLocale must be used within AppLocaleProvider");
  }
  return ctx;
}
