import { Outlet, useLocation } from "react-router-dom";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { isDesktopSelfManagedRoute } from "../../lib/desktopLayout";
import DesktopAppShell from "./DesktopAppShell";

export default function AppLayout() {
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();

  if (isDesktop && !isDesktopSelfManagedRoute(pathname)) {
    return (
      <DesktopAppShell>
        <Outlet />
      </DesktopAppShell>
    );
  }

  return <Outlet />;
}
