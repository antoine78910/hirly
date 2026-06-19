import { createContext, useCallback, useContext, useState } from "react";
import DesktopUpgradeModal from "../components/upgrade/DesktopUpgradeModal";

const UpgradeModalContext = createContext({
  upgradeOpen: false,
  openUpgrade: () => {},
  closeUpgrade: () => {},
});

export function UpgradeModalProvider({ children }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const openUpgrade = useCallback(() => setUpgradeOpen(true), []);
  const closeUpgrade = useCallback(() => setUpgradeOpen(false), []);

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
