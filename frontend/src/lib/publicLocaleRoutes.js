/**
 * Authoritative public-web locale URLs. These helpers intentionally only build
 * metadata/links; callers must not mount a locale route until its page has an
 * authored catalog for that locale.
 */
export const PUBLIC_LOCALES = Object.freeze(["en", "fr", "de", "es", "it"]);
export const DEFAULT_PUBLIC_LOCALE = "en";

export const PUBLIC_LOCALE_METADATA = Object.freeze({
  en: Object.freeze({ label: "English", hreflang: "en" }),
  fr: Object.freeze({ label: "Français", hreflang: "fr" }),
  de: Object.freeze({ label: "Deutsch", hreflang: "de" }),
  es: Object.freeze({ label: "Español", hreflang: "es" }),
  it: Object.freeze({ label: "Italiano", hreflang: "it" }),
});

export function isPublicLocale(locale) {
  return PUBLIC_LOCALES.includes(locale);
}

export function assertPublicLocale(locale) {
  if (!isPublicLocale(locale)) {
    throw new RangeError(`Unsupported public locale: ${String(locale)}`);
  }
  return locale;
}

/** Normalizes an internal public pathname and rejects query/hash/origin input. */
export function normalizePublicPath(pathname = "/") {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    throw new TypeError("Public paths must be internal absolute pathnames");
  }
  if (pathname.includes("?") || pathname.includes("#") || pathname.includes("://")) {
    throw new TypeError("Public paths cannot include an origin, query, or hash");
  }
  const normalized = pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  const segment = normalized.split("/")[1];
  if (PUBLIC_LOCALES.includes(segment)) {
    throw new TypeError("Public path must be locale-neutral");
  }
  return normalized;
}

/** English is the unprefixed canonical default; all other locales are prefixed. */
export function publicLocalePath(locale, pathname = "/") {
  assertPublicLocale(locale);
  const path = normalizePublicPath(pathname);
  return locale === DEFAULT_PUBLIC_LOCALE ? path : `/${locale}${path === "/" ? "" : path}`;
}

export function publicCanonicalUrl(locale, pathname = "/", siteUrl = "https://tryhirly.com") {
  if (typeof siteUrl !== "string" || !/^https:\/\//.test(siteUrl)) {
    throw new TypeError("Public site URL must be an HTTPS origin");
  }
  return `${siteUrl.replace(/\/$/, "")}${publicLocalePath(locale, pathname)}`;
}

/** Produces the complete five-language alternate set plus the default entry. */
export function publicHreflangLinks(
  pathname = "/",
  siteUrl = "https://tryhirly.com",
  availableLocales,
) {
  if (!Array.isArray(availableLocales) || availableLocales.length === 0) {
    throw new TypeError(
      "Public alternate links require a non-empty explicitly available locale set",
    );
  }
  const locales = [...new Set(availableLocales.map(assertPublicLocale))];
  const links = locales.map((locale) => ({
    hrefLang: PUBLIC_LOCALE_METADATA[locale].hreflang,
    href: publicCanonicalUrl(locale, pathname, siteUrl),
  }));
  const defaultLocale = locales.includes(DEFAULT_PUBLIC_LOCALE)
    ? DEFAULT_PUBLIC_LOCALE
    : locales[0];
  links.push({ hrefLang: "x-default", href: publicCanonicalUrl(defaultLocale, pathname, siteUrl) });
  return links;
}
