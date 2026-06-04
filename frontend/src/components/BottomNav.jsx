import { NavLink, useLocation } from "react-router-dom";
import { Sparkles, MessageSquare, LayoutGrid, TrendingUp, User as UserIcon } from "lucide-react";

const tabs = [
  { to: "/swipe",      label: "Discover",   icon: Sparkles,       testid: "nav-swipe" },
  { to: "/interviews", label: "Interviews", icon: MessageSquare,  testid: "nav-interviews" },
  { to: "/tracker",    label: "Pipeline",   icon: LayoutGrid,     testid: "nav-tracker" },
  { to: "/improve",    label: "Improve",    icon: TrendingUp,     testid: "nav-improve" },
  { to: "/profile",    label: "Me",         icon: UserIcon,       testid: "nav-profile" },
];

export default function BottomNav() {
  const location = useLocation();
  if (["/", "/onboarding"].includes(location.pathname)) return null;
  return (
    <nav
      className="sprout fixed bottom-0 inset-x-0 z-50 pb-safe pt-2 px-2 bg-black/95 backdrop-blur-xl border-t border-sprout-border"
      data-testid="bottom-nav"
    >
      <div className="max-w-md mx-auto flex justify-between items-center">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = location.pathname === t.to;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              data-testid={t.testid}
              className={`flex flex-col items-center gap-1 px-3 py-2 ${
                isActive ? "text-sprout-mint" : "text-zinc-500"
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.4 : 1.9} />
              <span className={`text-[11px] tracking-wide ${isActive ? "font-bold" : "font-medium"}`}>{t.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
