import {
  Briefcase,
  FileText,
  Layers,
  Mail,
  Sparkles,
  User,
} from "lucide-react";

export const DESKTOP_NAV_ITEMS = [
  { to: "/swipe", label: "Jobs", icon: Briefcase, end: true },
  { to: "/review", label: "Review", icon: FileText },
  { to: "/tracker", label: "Applications", icon: Layers },
  { to: "/improve", label: "Opportunities", icon: Sparkles },
  { to: "/emails", label: "Inbox", icon: Mail },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/settings", label: "AI Settings", icon: Sparkles },
];
