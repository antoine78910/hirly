import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import DesktopUpgradeModal from "../components/upgrade/DesktopUpgradeModal";
import { useAppLocale } from "./AppLocaleContext";
import { syncBillingAfterCheckout } from "../lib/billingSync";
import { captureCheckoutSessionFromSearch } from "../lib/pendingCheckout";
import { backendHasNewerFrontend } from "../lib/frontendVersion";

const UpgradeModalContext = createContext({
  upgradeOpen: false,
  openUpgrade: () => {},
  closeUpgrade: () => {},
});

export function UpgradeModalProvider({ children }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useAppLocale();
  const openUpgrade = useCallback(async () => {
    // A backend rollout can reach users before its matching frontend bundle.
    // Keep the modal closed until this client matches the deployed backend.
    if (await backendHasNewerFrontend()) return;
    setUpgradeOpen(true);
  }, []);
  const closeUpgrade = useCallback(() => setUpgradeOpen(false), []);

  useEffect(() => {
    captureCheckoutSessionFromSearch(location.search);
    const params = new URLSearchParams(location.search);
    const upgradeStatus = params.get("upgrade") || params.get("checkout");
    if (!upgradeStatus) return;

    const sessionId = params.get("session_id");
    const isOnboardingRoute = location.pathname === "/onboarding";

    // Onboarding owns Stripe return UX (full-screen paywall, not the in-app upgrade modal).
    if (isOnboardingRoute) return;

    params.delete("upgrade");
    params.delete("checkout");
    params.delete("session_id");
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );

    if (upgradeStatus === "cancelled") {
      void openUpgrade();
      toast(t("upgrade.checkoutCancelled"));
      return;
    }

    if (upgradeStatus === "success") {
      toast.success(t("upgrade.checkoutSuccess"));
      void syncBillingAfterCheckout({ sessionId, maxAttempts: 15, delayMs: 1500 });
    }
  }, [location.pathname, location.search, navigate, openUpgrade, t]);

  return (
    <UpgradeModalContext.Provider value={{ upgradeOpen, openUpgrade, closeUpgrade }}>
      {children}
      <DesktopUpgradeModal open={upgradeOpen} onClose={closeUpgrade} />
    </UpgradeModalContext.Provider>
  );
}

export function useUpgradeModal() {
  return useContext(UpgradeModalContext);
}
