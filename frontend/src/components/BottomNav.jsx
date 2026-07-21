import { NavLink, useLocation } from "react-router-dom";
import {
  Sparkles,
  FileText,
  Layers,
  Mail,
  User as UserIcon,
} from "lucide-react";
import { useAppLocale } from "../context/AppLocaleContext";
import { DemoAccountAvatarIndicator } from "./settings/DemoAccountBadge";

export default function BottomNav() {
  const location = useLocation();
  const { t } = useAppLocale();

  const tabs = [
    { to: "/swipe", label: t("nav.feed"), icon: Sparkles, testid: "nav-feed" },
    { to: "/review", label: t("nav.review"), icon: FileText, testid: "nav-review" },
    { to: "/tracker", label: t("nav.applications"), icon: Layers, testid: "nav-applications" },
    { to: "/emails", label: t("nav.inbox"), icon: Mail, testid: "nav-inbox" },
    { to: "/profile", label: t("nav.profile"), icon: UserIcon, testid: "nav-profile" },
  ];

  return (
    <nav
      className="bottom-nav fixed inset-x-0 bottom-0 z-50 border-t border-sprout-border bg-sprout-surface/95 pb-safe pt-1.5 backdrop-blur-xl md:hidden"
      data-testid="bottom-nav"
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-5 items-end px-safe">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            location.pathname === tab.to
            || (tab.to === "/swipe" && location.pathname === "/app");
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              data-testid={tab.testid}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-0 py-1.5 ${
                isActive ? "text-sprout-text" : "text-sprout-dim"
              }`}
            >
              <span className="relative inline-flex">
                <Icon
                  className="h-[18px] w-[18px] shrink-0 sm:h-5 sm:w-5"
                  strokeWidth={isActive ? 2.4 : 1.8}
                  fill={isActive && tab.to === "/review" ? "currentColor" : "none"}
                />
                {tab.to === "/profile" ? (
                  <DemoAccountAvatarIndicator size="sm" className="-bottom-1 -right-1.5" />
                ) : null}
              </span>
              <span
                className={`w-full truncate text-center text-[9px] leading-tight sm:text-[10px] ${
                  isActive ? "font-semibold" : "font-medium"
                }`}
              >
                {tab.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}