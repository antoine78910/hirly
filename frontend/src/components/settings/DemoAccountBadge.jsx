import { FlaskConical } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import { isDemoAccountEnabled } from "../../lib/demoAccount";

export function useIsDemoAccount() {
  const { user } = useAuth();
  return Boolean(user?.demo_account) || isDemoAccountEnabled();
}

/** Small flask badge on the bottom-right corner of a profile avatar. */
export function DemoAccountAvatarIndicator({ className = "", size = "md" }) {
  const { t } = useAppLocale();
  const isDemo = useIsDemoAccount();

  if (!isDemo) return null;

  const sizes = {
    sm: { wrap: "h-3.5 w-3.5", icon: "h-2 w-2", border: "border-[1.5px]" },
    md: { wrap: "h-4 w-4", icon: "h-2.5 w-2.5", border: "border-2" },
  };
  const s = sizes[size] || sizes.md;

  return (
    <span
      role="img"
      className={`absolute -bottom-0.5 -right-0.5 z-10 grid ${s.wrap} place-items-center rounded-full ${s.border} border-white bg-amber-500 text-white shadow-sm dark:border-zinc-900 ${className}`}
      title={t("demo.badge")}
      aria-label={t("demo.badge")}
      data-testid="demo-account-avatar-indicator"
    >
      <FlaskConical className={s.icon} strokeWidth={2.5} aria-hidden />
    </span>
  );
}
