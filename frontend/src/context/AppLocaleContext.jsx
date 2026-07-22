import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { appT, isAppLanguage, readStoredAppLang } from "../lib/appUi";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

const STORAGE_KEY = "hirly_app_lang";

const AppLocaleContext = createContext(null);

export function AppLocaleProvider({ children }) {
  const [lang, setLangState] = useState(readStoredAppLang);
  const { user, setUser } = useAuth() || {};
  const hydratedUserIdRef = useRef(null);

  const setLang = useCallback(
    (next) => {
      const value = isAppLanguage(next) ? next : "en";
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch (_) {}
      setLangState(value);
      if (user?.user_id) {
        api
          .put("/account/settings", { language: value })
          .then(() => setUser?.((prev) => (prev ? { ...prev, language: value } : prev)))
          .catch(() => {});
      }
    },
    [user?.user_id, setUser],
  );

  // Backend notifications (credits granted, offer expired, ...) are worded
  // server-side, so the backend needs to know which language the user has
  // selected. Once per login: adopt the backend's stored language (so a
  // user's preference follows them across devices), or if they've never set
  // one server-side, push this browser's current language so it does.
  useEffect(() => {
    if (!user?.user_id || hydratedUserIdRef.current === user.user_id) return;
    hydratedUserIdRef.current = user.user_id;
    if (isAppLanguage(user.language)) {
      if (user.language !== lang) {
        setLangState(user.language);
        try {
          localStorage.setItem(STORAGE_KEY, user.language);
        } catch (_) {}
      }
    } else {
      api.put("/account/settings", { language: lang }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id, user?.language]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback((key, vars) => appT(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <AppLocaleContext.Provider value={value}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale() {
  const ctx = useContext(AppLocaleContext);
  if (!ctx) {
    throw new Error("useAppLocale must be used within AppLocaleProvider");
  }
  return ctx;
}
