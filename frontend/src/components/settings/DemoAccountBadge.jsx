import { FlaskConical } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import { isDemoAccountEnabled } from "../../lib/demoAccount";

export default function DemoAccountBadge({ className = "", compact = false, variant = "light" }) {
  const { user } = useAuth();
  const { t } = useAppLocale();
  const isDemo = Boolean(user?.demo_account) || isDemoAccountEnabled();

  if (!isDemo) return null;

  const isDark = variant === "dark";

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
          isDark
            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-600"
        } ${className}`}
        data-testid="demo-account-badge"
      >
        <FlaskConical className="h-3 w-3" aria-hidden />
        {t("demo.badge")}
      </span>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
        isDark
          ? "border-amber-400/25 bg-amber-400/10"
          : "border-amber-500/25 bg-amber-500/10"
      } ${className}`}
      data-testid="demo-account-banner"
    >
      <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isDark ? "bg-amber-400/15" : "bg-amber-500/15"}`}>
        <FlaskConical className={`h-4 w-4 ${isDark ? "text-amber-300" : "text-amber-600"}`} aria-hidden />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${isDark ? "text-amber-200" : "text-amber-700"}`}>{t("demo.badge")}</p>
        <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-amber-200/75" : "text-amber-700/80"}`}>
          {t("demo.banner")}
        </p>
      </div>
    </div>
  );
}
