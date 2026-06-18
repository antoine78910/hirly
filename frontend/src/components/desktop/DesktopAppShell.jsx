import { createContext, useContext, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Headphones, Sun } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import DesktopCreditsPill from "./DesktopCreditsPill";
import {
  DESKTOP_THEMES,
  readDesktopTheme,
  saveDesktopTheme,
} from "../swipe/desktopFeedTheme";
import { DESKTOP_NAV_ITEMS } from "./desktopNav";

const DesktopThemeContext = createContext({ themeMode: "light", isDark: false, theme: DESKTOP_THEMES.light });

export function useDesktopTheme() {
  return useContext(DesktopThemeContext);
}

export default function DesktopAppShell({ children, headerRight = null }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
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

  return (
    <DesktopThemeContext.Provider value={{ themeMode, isDark, theme }}>
    <div className={`flex h-dvh ${theme.root}`} data-theme={themeMode}>
      <aside className={`flex w-56 shrink-0 flex-col border-r px-3 py-4 lg:w-60 ${theme.sidebar}`}>
        <button
          type="button"
          onClick={() => navigate("/profile")}
          className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${theme.accountBtn}`}
        >
          <span className="truncate font-medium">{user?.email || "Account"}</span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
        </button>

        <p className={`mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider ${theme.sectionLabel}`}>
          Platform
        </p>
        <nav className="mt-2 flex flex-col gap-0.5">
          {DESKTOP_NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => {
                const active = isActive || (to === "/swipe" && pathname === "/app");
                return `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  active ? theme.navActive : theme.navIdle
                }`;
              }}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3 px-1 pt-6">
          <div className={`rounded-xl border p-3 ${theme.tourCard}`}>
            <p className={`text-sm font-semibold ${theme.tourTitle}`}>Tour completed</p>
            <button type="button" className="mt-1 text-xs font-medium text-violet-500 hover:text-violet-600">
              Restart tour
            </button>
          </div>
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm ${theme.supportBtn}`}
          >
            <Headphones className="h-4 w-4" />
            Support
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex items-center justify-end gap-3 border-b px-6 py-3 ${theme.header}`}>
          {headerRight}
          <DesktopCreditsPill isDark={isDark} />
          <button
            type="button"
            onClick={toggleTheme}
            className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
              isDark ? theme.iconBtn : `${theme.iconBtn} text-amber-500`
            }`}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
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
