import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

import { isTrainingRoute } from "../../lib/trainingRoutes";

function usesDocumentScroll(pathname) {
  if (pathname === "/" || pathname === "/signup" || pathname === "/auth/callback") return true;
  if (pathname === "/credits" || pathname === "/referral") return true;
  if (isTrainingRoute(pathname)) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  return false;
}

function usesAppShellScroll(pathname) {
  return false;
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

    return () => {
      html.classList.remove("document-scroll", "app-shell-locked");
      body.classList.remove("document-scroll", "app-shell-locked");
      root?.classList.remove("document-scroll");
      app?.classList.remove("document-scroll");
    };
  }, [pathname]);

  return null;
}
