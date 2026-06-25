import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, BookOpen, ClipboardList, LayoutDashboard, Megaphone, MessageSquare, Users, GraduationCap } from "lucide-react";
import { BRAND } from "../../lib/brand";
import { trackEvent } from "../../lib/analytics";

const navItems = [
  { to: "/admin/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/applications", label: "Applications", icon: ClipboardList },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/influencers", label: "Influencers", icon: Megaphone },
  { to: "/admin/creators", label: "Creators", icon: GraduationCap },
  { to: "/admin/training", label: "Training", icon: BookOpen },
  { to: "/admin/features", label: "Features", icon: MessageSquare },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

export default function AdminShell({ title, subtitle, actions, children }) {
  const location = useLocation();

  useEffect(() => {
    trackEvent("admin_view", { page: location.pathname, title });
  }, [location.pathname, title]);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-200 bg-white p-4 lg:block">
        <div className="px-2 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{BRAND.NAME}</p>
          <h1 className="font-display text-xl font-bold">Admin</h1>
        </div>
        <nav className="mt-6 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${
                  isActive ? "bg-linkedin text-white" : "text-zinc-700 hover:bg-zinc-100"
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
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{BRAND.NAME} Admin</p>
              <h1 className="font-display text-2xl font-bold">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
          <nav className="flex gap-2 overflow-x-auto border-t border-zinc-100 px-6 py-2 lg:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${
                  isActive ? "bg-linkedin text-white" : "bg-zinc-100 text-zinc-700"
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
  );
}

export function AdminAccessDenied() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center">
      <h2 className="font-display text-xl font-bold text-red-700">Admin access denied</h2>
      <p className="mt-2 text-sm text-red-600">Your account is not allowed to view admin operations data.</p>
    </div>
  );
}
