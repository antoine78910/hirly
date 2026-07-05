import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  domainSplitEnabled,
  isAppHost,
  isAppPath,
  isMarketingHost,
  isMarketingPath,
  isSharedPath,
  appUrl,
  marketingUrl,
} from "../lib/appDomains";

/**
 * Keeps marketing routes on tryhirly.com and app routes on app.tryhirly.com.
 * Auth callback is allowed on both hosts.
 */
export default function DomainRouter({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!domainSplitEnabled()) return;

    const { pathname, search, hash } = location;
    if (isSharedPath(pathname)) return;

    if (isAppHost()) {
      if (pathname === "/") {
        navigate(`/swipe${search}${hash}`, { replace: true });
        return;
      }
      if (isMarketingPath(pathname)) {
        window.location.replace(marketingUrl(pathname, search, hash));
      }
      return;
    }

    if (isMarketingHost() && isAppPath(pathname)) {
      window.location.replace(appUrl(pathname, search, hash));
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  return children;
}
