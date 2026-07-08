import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import DesktopUpgradeModal from "../components/upgrade/DesktopUpgradeModal";
import { useAppLocale } from "./AppLocaleContext";
import { syncBillingAfterCheckout } from "../lib/billingSync";

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
  const openUpgrade = useCallback(() => setUpgradeOpen(true), []);
  const closeUpgrade = useCallback(() => setUpgradeOpen(false), []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const upgradeStatus = params.get("upgrade") || params.get("checkout");
    if (!upgradeStatus) return;

    const sessionId = params.get("session_id");

    params.delete("upgrade");
    params.delete("checkout");
    params.delete("session_id");
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );

    if (upgradeStatus === "cancelled") {
      setUpgradeOpen(true);
      toast(t("upgrade.checkoutCancelled"));
      return;
    }

    if (upgradeStatus === "success") {
      toast.success(t("upgrade.checkoutSuccess"));
      syncBillingAfterCheckout({ sessionId }).catch(() => {});
    }
  }, [location.pathname, location.search, navigate, t]);

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
