import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { api } from "../../lib/api";
import {
  DEMO_CREDITS_CHANGED,
  getDemoCreditsRemaining,
  isDemoAccountEnabled,
} from "../../lib/demoAccount";

const DEFAULT_SWIPE_CREDITS = 40;

export function useSwipeCredits() {
  const [credits, setCredits] = useState(DEFAULT_SWIPE_CREDITS);
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demoAccount, setDemoAccount] = useState(() => isDemoAccountEnabled());

  useEffect(() => {
    const syncDemo = () => setDemoAccount(isDemoAccountEnabled());
    const onCreditsChange = () => {
      if (isDemoAccountEnabled()) setCredits(getDemoCreditsRemaining());
    };

    window.addEventListener(DEMO_CREDITS_CHANGED, onCreditsChange);
    window.addEventListener("storage", syncDemo);
    window.addEventListener("hirly:ai-settings-changed", syncDemo);
    return () => {
      window.removeEventListener(DEMO_CREDITS_CHANGED, onCreditsChange);
      window.removeEventListener("storage", syncDemo);
      window.removeEventListener("hirly:ai-settings-changed", syncDemo);
    };
  }, []);

  useEffect(() => {
    if (demoAccount) {
      setCredits(getDemoCreditsRemaining());
      setIsPremium(false);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    api.get("/billing/status")
      .then(({ data }) => {
        setIsPremium(Boolean(data?.is_premium));
      })
      .catch(() => setIsPremium(false))
      .finally(() => setLoading(false));
  }, [demoAccount]);

  const displayCredits = demoAccount ? credits : (isPremium ? "∞" : credits);

  return { credits, isPremium, loading, displayCredits, demoAccount };
}

export default function DesktopCreditsPill({ isDark = false, className = "" }) {
  const navigate = useNavigate();
  const { displayCredits, loading, isPremium, demoAccount } = useSwipeCredits();

  return (
    <button
      type="button"
      onClick={() => !demoAccount && navigate("/credits")}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${
        demoAccount ? "cursor-default" : "hover:scale-[1.02]"
      } ${
        isDark
          ? "border-violet-500/30 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
          : "border-violet-200 bg-gradient-to-r from-violet-50 to-blue-50 text-violet-700 shadow-sm hover:from-violet-100 hover:to-blue-100"
      } ${className}`}
      aria-label={demoAccount ? "Demo credits" : "View credits"}
      data-testid="desktop-credits-pill"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 shadow-sm">
        <Zap className="h-3.5 w-3.5 text-white" fill="white" />
      </span>
      <span className="tabular-nums">
        {loading ? "—" : displayCredits}
      </span>
      <span className={`text-xs font-medium ${isDark ? "text-violet-300/80" : "text-violet-500/80"}`}>
        {demoAccount ? "Demo credits" : (isPremium ? "Unlimited" : "Credits")}
      </span>
    </button>
  );
}
