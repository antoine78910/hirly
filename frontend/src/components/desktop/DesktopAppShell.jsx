import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Headphones, Sun } from "lucide-react";
import { useAppLocale } from "../../context/AppLocaleContext";
import DesktopCreditsPill from "./DesktopCreditsPill";
import DesktopAccountMenu from "./DesktopAccountMenu";
import {
  DESKTOP_THEMES,
  readDesktopTheme,
  saveDesktopTheme,
} from "../swipe/desktopFeedTheme";
import { getDesktopNavItems } from "./desktopNav";
import LanguageSwitcher from "../settings/LanguageSwitcher";

const DesktopThemeContext = createContext({ themeMode: "light", isDark: false, theme: DESKTOP_THEMES.light });

export function useDesktopTheme() {
  return useContext(DesktopThemeContext);
}

export default function DesktopAppShell({ children, headerRight = null }) {
  const { pathname } = useLocation();
  const { t } = useAppLocale();
  const navItems = getDesktopNavItems(t);
  const [themeMode, setThemeMode] = useState(readDesktopTheme);
  const isDark = themeMode === "dark";
  const theme = DESKTOP_THEMES[themeMode];

  const toggleTheme = () => {
    setThemeMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      saveDesktopTheme(next);
      return next;
    });
  };

  useEffect(() => {
    const onThemeChange = (event) => {
      const next = event.detail === "dark" ? "dark" : "light";
      setThemeMode(next);
    };
    window.addEventListener("desktop-theme-change", onThemeChange);
    return () => window.removeEventListener("desktop-theme-change", onThemeChange);
  }, []);

  return (
    <DesktopThemeContext.Provider value={{ themeMode, isDark, theme }}>
    <div className={`flex h-dvh ${theme.root} ${isDark ? "dark" : ""}`} data-theme={themeMode}>
      <aside className={`flex w-56 shrink-0 flex-col border-r px-3 py-4 lg:w-60 ${theme.sidebar}`}>
        <DesktopAccountMenu
          triggerClassName={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${theme.accountBtn}`}
        />

        <p className={`mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider ${theme.sectionLabel}`}>
          {t("common.platform")}
        </p>
        <nav className="mt-2 flex flex-col gap-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => {
                const active = isActive || (to === "/swipe" && pathname === "/app");
                return `flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  active ? theme.navActive : theme.navIdle
                }`;
              }}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3 px-1 pt-6">
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm ${theme.supportBtn}`}
          >
            <Headphones className="h-4 w-4" />
            {t("common.support")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex items-center justify-end gap-3 border-b px-6 py-3 ${theme.header}`}>
          {headerRight}
          <LanguageSwitcher variant={isDark ? "dark" : "light"} />
          <DesktopCreditsPill isDark={isDark} />
          <button
            type="button"
            onClick={toggleTheme}
            className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
              isDark ? theme.iconBtn : `${theme.iconBtn} text-amber-500`
            }`}
            aria-label={isDark ? t("swipe.switchLight") : t("swipe.switchDark")}
            data-testid="desktop-theme-toggle"
          >
            <Sun className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
    </DesktopThemeContext.Provider>
  );
}
