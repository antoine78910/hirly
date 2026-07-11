import { createContext, useContext, useEffect, useState } from "react";
import { applyMobileTheme, readMobileTheme, saveMobileTheme } from "../lib/mobileTheme";

const MobileThemeContext = createContext(null);

export function MobileThemeProvider({ children }) {
  const [theme, setTheme] = useState(readMobileTheme);

  useEffect(() => {
    applyMobileTheme(readMobileTheme());
    const onChange = (event) => {
      setTheme(event.detail === "dark" ? "dark" : "light");
    };
    window.addEventListener("mobile-theme-change", onChange);
    return () => window.removeEventListener("mobile-theme-change", onChange);
  }, []);

  const setMobileTheme = (next) => {
    setTheme(saveMobileTheme(next));
  };

  return (
    <MobileThemeContext.Provider value={{ theme, setMobileTheme }}>
      {children}
    </MobileThemeContext.Provider>
  );
}

export function useMobileTheme() {
  const ctx = useContext(MobileThemeContext);
  if (!ctx) {
    return {
      theme: readMobileTheme(),
      setMobileTheme: saveMobileTheme,
    };
  }
  return ctx;
}
