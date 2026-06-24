import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { api } from "../../lib/api";
import { useUpgradeModal } from "../../context/UpgradeModalContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import {
  DEMO_ACCOUNT_CHANGED,
  DEMO_CREDITS_CHANGED,
  getDemoCreditsRemaining,
  isDemoAccountEnabled,
} from "../../lib/demoAccount";

export function useSwipeCredits() {
  const [credits, setCredits] = useState(() => (
    isDemoAccountEnabled() ? getDemoCreditsRemaining() : 0
  ));
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoAccount, setDemoAccount] = useState(() => isDemoAccountEnabled());

  useEffect(() => {
    const syncDemo = () => setDemoAccount(isDemoAccountEnabled());
    const onCreditsChange = () => {
      if (isDemoAccountEnabled()) setCredits(getDemoCreditsRemaining());
    };

    window.addEventListener(DEMO_CREDITS_CHANGED, onCreditsChange);
    window.addEventListener(DEMO_ACCOUNT_CHANGED, syncDemo);
    return () => {
      window.removeEventListener(DEMO_CREDITS_CHANGED, onCreditsChange);
      window.removeEventListener(DEMO_ACCOUNT_CHANGED, syncDemo);
    };
  }, []);

  useEffect(() => {
    if (demoAccount) {
      setCredits(getDemoCreditsRemaining());
      setIsPremium(false);
      setLoading(false);
      return undefined;
    }

    setCredits(0);
    setLoading(true);
    api.get("/billing/status")
      .then(({ data }) => {
        setIsPremium(Boolean(data?.is_premium));
        setCredits(Number(data?.credits_remaining ?? 0));
      })
      .catch(() => {
        setIsPremium(false);
        setCredits(0);
      })
      .finally(() => setLoading(false));
  }, [demoAccount]);

  return { credits, isPremium, loading, displayCredits: credits, demoAccount };
}

export default function DesktopCreditsPill({ isDark = false, className = "" }) {
  const { openUpgrade } = useUpgradeModal();
  const { t } = useAppLocale();
  const { displayCredits, loading, isPremium } = useSwipeCredits();

  return (
    <button
      type="button"
      onClick={() => {
        if (!isPremium) openUpgrade();
      }}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${
        isPremium ? "cursor-default" : "hover:scale-[1.02]"
      } ${
        isDark
          ? "border-violet-500/30 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
          : "border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50 text-violet-700 shadow-sm hover:from-violet-100 hover:to-blue-100"
      } ${className}`}
      aria-label={isPremium ? t("common.credits") : t("credits.viewPlans")}
      data-testid="desktop-credits-pill"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 shadow-sm">
        <Zap className="h-3.5 w-3.5 text-white" fill="white" />
      </span>
      <span className="tabular-nums">
        {loading ? "-" : displayCredits}
      </span>
      <span className={`text-xs font-medium ${isDark ? "text-violet-300/80" : "text-violet-500/80"}`}>
        {t("common.credits")}
      </span>
    </button>
  );
}
