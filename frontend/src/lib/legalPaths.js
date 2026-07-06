import { isAppHost, isLocalDevHost, marketingUrl } from "./appDomains";

export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";

/** Absolute marketing URL in production; same-origin path on localhost. */
export function termsHref() {
  if (isLocalDevHost() || !isAppHost()) return TERMS_PATH;
  return marketingUrl(TERMS_PATH);
}

export function privacyHref() {
  if (isLocalDevHost() || !isAppHost()) return PRIVACY_PATH;
  return marketingUrl(PRIVACY_PATH);
}

/** Open legal pages in a new tab when leaving the app subdomain. */
export function shouldOpenLegalInNewTab() {
  return !isLocalDevHost() && isAppHost();
}

export function legalHref(page) {
  return page === "privacy" ? privacyHref() : termsHref();
}
