import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Moon,
  Sun,
  UserSearch,
  Users,
  FlaskConical,
} from "lucide-react";
import { BRAND } from "../../lib/brand";
import { trackEvent } from "../../lib/analytics";
import { Button } from "../ui/button";

const navItems = [
  { to: "/admin/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { to: "/admin/applications", label: "Applications", icon: ClipboardList },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/user-analytics", label: "User Analytics", icon: UserSearch },
  { to: "/admin/influencers", label: "Influencers", icon: Megaphone },
  { to: "/admin/creators", label: "Creators", icon: GraduationCap },
  { to: "/admin/training", label: "Training", icon: BookOpen },
  { to: "/admin/features", label: "Features", icon: MessageSquare },
  { to: "/admin/ats-lab", label: "ATS Lab", icon: FlaskConical },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

const AdminThemeContext = createContext({ dark: false });

export function useAdminDark() {
  return useContext(AdminThemeContext).dark;
}

const DARK_STORAGE_KEY = "hirly-admin-dark";

export default function AdminShell({
  title,
  subtitle,
  actions,
  children,
  enableDarkMode = false,
}) {
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DARK_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    trackEvent("admin_view", { page: location.pathname, title });
  }, [location.pathname, title]);

  useEffect(() => {
    if (!enableDarkMode) return;
    window.localStorage.setItem(DARK_STORAGE_KEY, dark ? "1" : "0");
  }, [dark, enableDarkMode]);

  const isDark = enableDarkMode && dark;

  const darkToggle = enableDarkMode ? (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setDark((value) => !value)}
      className="cursor-pointer border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  ) : null;

  return (
    <AdminThemeContext.Provider value={{ dark: isDark }}>
      <div className={`min-h-dvh bg-zinc-50 text-zinc-950 ${isDark ? "dark" : ""}`}>
        <div className="min-h-dvh bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
          <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:block">
            <div className="px-2 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {BRAND.NAME}
              </p>
              <h1 className="font-display text-xl font-bold text-zinc-900 dark:text-zinc-100">Admin</h1>
            </div>
            <nav className="mt-6 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${
                      isActive
                        ? "bg-linkedin text-white"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
          </aside>

          <div className="lg:pl-64">
            <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {BRAND.NAME} Admin
                  </p>
                  <h1 className="font-display text-2xl font-bold text-zinc-900 dark:text-zinc-100">{title}</h1>
                  {subtitle ? <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {darkToggle}
                  {actions}
                </div>
              </div>
              <nav className="flex gap-2 overflow-x-auto border-t border-zinc-100 px-6 py-2 dark:border-zinc-800 lg:hidden">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${
                      isActive
                        ? "bg-linkedin text-white"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </header>
            <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
          </div>
        </div>
      </div>
    </AdminThemeContext.Provider>
  );
}

export function AdminAccessDenied() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center dark:border-red-900/60 dark:bg-red-950/40">
      <h2 className="font-display text-xl font-bold text-red-700 dark:text-red-300">Admin access denied</h2>
      <p className="mt-2 text-sm text-red-600 dark:text-red-400">
        Your account is not allowed to view admin operations data.
      </p>
    </div>
  );
}
