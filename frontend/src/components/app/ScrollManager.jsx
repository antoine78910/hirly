import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

import { isTrainingRoute } from "../../lib/trainingRoutes";

function usesDocumentScroll(pathname) {
  if (pathname === "/" || pathname === "/signup" || pathname === "/auth/callback") return true;
  if (pathname === "/referral") return true;
  if (pathname === "/how-it-works" || pathname === "/use-cases") return true;
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return true;
  if (pathname.startsWith("/compare/")) return true;
  if (pathname.startsWith("/for/")) return true;
  if (isTrainingRoute(pathname)) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  return false;
}

/** Bottom-nav app pages scroll inside AppPageScroll / DesktopAppShell — lock the document. */
function usesAppShellScroll(pathname) {
  if (usesDocumentScroll(pathname)) return false;
  if (pathname.startsWith("/invite/")) return false;
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return false;
  if (pathname === "/billing") return false;
  return true;
}

/** Route-aware scroll: force native document scroll on long pages. */
export default function ScrollManager() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const app = document.querySelector(".App");

    const documentScroll = usesDocumentScroll(pathname);
    const appShell = usesAppShellScroll(pathname);

    html.classList.toggle("document-scroll", documentScroll);
    body.classList.toggle("document-scroll", documentScroll);
    root?.classList.toggle("document-scroll", documentScroll);
    app?.classList.toggle("document-scroll", documentScroll);

    html.classList.toggle("app-shell-locked", appShell);
    body.classList.toggle("app-shell-locked", appShell);
    body.dataset.trainingPage = isTrainingRoute(pathname) ? "true" : "";

    return () => {
      html.classList.remove("document-scroll", "app-shell-locked");
      body.classList.remove("document-scroll", "app-shell-locked");
      root?.classList.remove("document-scroll");
      app?.classList.remove("document-scroll");
      delete body.dataset.trainingPage;
    };
  }, [pathname]);

  return null;
}
