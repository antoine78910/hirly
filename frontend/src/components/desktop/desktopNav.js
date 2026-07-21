import {
  Briefcase,
  FileText,
  Layers,
  Mail,
  Sparkles,
  User,
} from "lucide-react";

export function getDesktopNavItems(t) {
  return [
    { to: "/swipe", label: t("nav.jobs"), icon: Briefcase, end: true },
    { to: "/review", label: t("nav.review"), icon: FileText },
    { to: "/tracker", label: t("nav.applications"), icon: Layers },
    { to: "/emails", label: t("nav.inbox"), icon: Mail },
    { to: "/profile", label: t("nav.profile"), icon: User },
    { to: "/settings", label: t("nav.aiSettings"), icon: Sparkles },
  ];
}
