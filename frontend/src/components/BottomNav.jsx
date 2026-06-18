import { NavLink, useLocation } from "react-router-dom";
import {
  Sparkles,
  FileText,
  Layers,
  Mail,
  User as UserIcon,
} from "lucide-react";

const tabs = [
  { to: "/swipe", label: "Feed", icon: Sparkles, testid: "nav-feed" },
  { to: "/review", label: "Review", icon: FileText, testid: "nav-review" },
  { to: "/tracker", label: "Applications", icon: Layers, testid: "nav-applications" },
  { to: "/emails", label: "Inbox", icon: Mail, testid: "nav-inbox" },
  { to: "/profile", label: "Profile", icon: UserIcon, testid: "nav-profile" },
];

export default function BottomNav() {
  const location = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 pb-safe pt-1.5 backdrop-blur-xl md:hidden"
      data-testid="bottom-nav"
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-5 items-end px-safe">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive =
            location.pathname === t.to
            || (t.to === "/swipe" && location.pathname === "/app");
          return (
            <NavLink
              key={t.to}
              to={t.to}
              data-testid={t.testid}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-0 py-1.5 ${
                isActive ? "text-zinc-900" : "text-zinc-400"
              }`}
            >
              <Icon
                className="h-[18px] w-[18px] shrink-0 sm:h-5 sm:w-5"
                strokeWidth={isActive ? 2.4 : 1.8}
                fill={isActive && t.to === "/review" ? "currentColor" : "none"}
              />
              <span
                className={`w-full truncate text-center text-[9px] leading-tight sm:text-[10px] ${
                  isActive ? "font-semibold" : "font-medium"
                }`}
              >
                {t.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
