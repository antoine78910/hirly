import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { api } from "../../lib/api";
import { useUpgradeModal } from "../../context/UpgradeModalContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import { formatPlanTier } from "../../lib/billingPlan";
import { BILLING_UPDATED } from "../../lib/billingEvents";
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
  const [planTier, setPlanTier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [demoAccount, setDemoAccount] = useState(() => isDemoAccountEnabled());

  useEffect(() => {
    const syncDemo = () => setDemoAccount(isDemoAccountEnabled());
    const onCreditsChange = () => {
      if (isDemoAccountEnabled()) setCredits(getDemoCreditsRemaining());
    };
    const onBillingUpdated = (event) => {
      if (isDemoAccountEnabled()) return;
      setIsPremium(Boolean(event?.detail?.is_premium));
      setCredits(Number(event?.detail?.credits_remaining ?? 0));
      setPlanTier(event?.detail?.plan_tier || event?.detail?.plan || null);
      setLoading(false);
    };

    window.addEventListener(DEMO_CREDITS_CHANGED, onCreditsChange);
    window.addEventListener(DEMO_ACCOUNT_CHANGED, syncDemo);
    window.addEventListener(BILLING_UPDATED, onBillingUpdated);
    return () => {
      window.removeEventListener(DEMO_CREDITS_CHANGED, onCreditsChange);
      window.removeEventListener(DEMO_ACCOUNT_CHANGED, syncDemo);
      window.removeEventListener(BILLING_UPDATED, onBillingUpdated);
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
        setPlanTier(data?.plan_tier || data?.plan || null);
      })
      .catch(() => {
        setIsPremium(false);
        setCredits(0);
      })
      .finally(() => setLoading(false));
  }, [demoAccount]);

  return { credits, isPremium, planTier, loading, displayCredits: credits, demoAccount };
}

export default function DesktopCreditsPill({
  isDark = false,
  className = "",
  forceOpenUpgrade = false,
  compact = false,
}) {
  const { openUpgrade } = useUpgradeModal();
  const { t } = useAppLocale();
  const { displayCredits, loading, isPremium, planTier, demoAccount } = useSwipeCredits();
  const tierLabel = isPremium ? formatPlanTier(planTier) : null;

  if (demoAccount) return null;

  const handleClick = () => {
    if (forceOpenUpgrade || !isPremium) openUpgrade();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center rounded-full border font-semibold transition-all ${
        compact ? "gap-1 px-2 py-1 text-xs" : "gap-2 px-3.5 py-1.5 text-sm"
      } ${
        forceOpenUpgrade || !isPremium ? "hover:scale-[1.02] cursor-pointer" : "cursor-default"
      } ${
        isDark
          ? "border-violet-500/30 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
          : "border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50 text-violet-700 shadow-sm hover:from-violet-100 hover:to-blue-100"
      } ${className}`}
      aria-label={isPremium && !forceOpenUpgrade ? t("common.credits") : t("credits.viewPlans")}
      data-testid="desktop-credits-pill"
    >
      <span className={`grid place-items-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 shadow-sm ${
        compact ? "h-5 w-5" : "h-6 w-6"
      }`}>
        <Zap className={`text-white ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`} fill="white" />
      </span>
      <span className="tabular-nums">
        {loading ? "-" : displayCredits}
      </span>
      {tierLabel ? (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          isDark ? "bg-violet-500/20 text-violet-200" : "bg-violet-100 text-violet-700"
        }`}>
          {tierLabel}
        </span>
      ) : null}
      {!compact ? (
        <span className={`text-xs font-medium ${isDark ? "text-violet-300/80" : "text-violet-500/80"}`}>
          {t("common.credits")}
        </span>
      ) : null}
    </button>
  );
}
