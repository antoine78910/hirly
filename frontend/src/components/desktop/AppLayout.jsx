import { Outlet, useLocation } from "react-router-dom";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { UpgradeModalProvider } from "../../context/UpgradeModalContext";
import { isDesktopSelfManagedRoute } from "../../lib/desktopLayout";
import MaintenanceBanner from "../maintenance/MaintenanceBanner";
import DesktopAppShell from "./DesktopAppShell";

export default function AppLayout() {
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  const content =
    isDesktop && !isDesktopSelfManagedRoute(pathname) ? (
      <DesktopAppShell>
        <Outlet />
      </DesktopAppShell>
    ) : (
      <Outlet />
    );

  return (
    <UpgradeModalProvider>
      <MaintenanceBanner />
      {content}
    </UpgradeModalProvider>
  );
}
