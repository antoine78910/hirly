import {
  DEFAULT_PUBLIC_LOCALE,
  PUBLIC_LOCALES,
  PUBLIC_LOCALE_METADATA,
  assertPublicLocale,
  normalizePublicPath,
  publicCanonicalUrl,
  publicHreflangLinks,
  publicLocalePath,
} from "./publicLocaleRoutes";

describe("public locale route matrix", () => {
  test("enumerates exactly the five product locales with metadata", () => {
    expect(PUBLIC_LOCALES).toEqual(["en", "fr", "de", "es", "it"]);
    expect(Object.keys(PUBLIC_LOCALE_METADATA).sort()).toEqual([...PUBLIC_LOCALES].sort());
    expect(DEFAULT_PUBLIC_LOCALE).toBe("en");
  });

  test("builds canonical public paths for every locale", () => {
    expect(publicLocalePath("en", "/how-it-works")).toBe("/how-it-works");
    for (const locale of ["fr", "de", "es", "it"]) {
      expect(publicLocalePath(locale, "/how-it-works")).toBe(`/${locale}/how-it-works`);
    }
  });

  test("creates a complete hreflang set from locale-neutral paths", () => {
    const links = publicHreflangLinks("/blog/how-to-apply", "https://tryhirly.com", PUBLIC_LOCALES);
    expect(links).toEqual([
      { hrefLang: "en", href: "https://tryhirly.com/blog/how-to-apply" },
      { hrefLang: "fr", href: "https://tryhirly.com/fr/blog/how-to-apply" },
      { hrefLang: "de", href: "https://tryhirly.com/de/blog/how-to-apply" },
      { hrefLang: "es", href: "https://tryhirly.com/es/blog/how-to-apply" },
      { hrefLang: "it", href: "https://tryhirly.com/it/blog/how-to-apply" },
      { hrefLang: "x-default", href: "https://tryhirly.com/blog/how-to-apply" },
    ]);
    expect(publicCanonicalUrl("de", "/")).toBe("https://tryhirly.com/de");
  });

  test("rejects unsupported locales and already-prefixed or external paths", () => {
    expect(() => assertPublicLocale("pt")).toThrow("Unsupported public locale");
    expect(() => publicLocalePath("pt", "/")).toThrow("Unsupported public locale");
    expect(() => normalizePublicPath("/de/blog")).toThrow("locale-neutral");
    expect(() => normalizePublicPath("https://other.example/blog")).toThrow("internal absolute");
  });

  test("requires route owners to declare the locales with authored content", () => {
    expect(() => publicHreflangLinks("/blog")).toThrow("non-empty explicitly available locale set");
    expect(() => publicHreflangLinks("/blog", "https://tryhirly.com", [])).toThrow(
      "non-empty explicitly available locale set",
    );
    expect(publicHreflangLinks("/blog", "https://tryhirly.com", ["en"])).toEqual([
      { hrefLang: "en", href: "https://tryhirly.com/blog" },
      { hrefLang: "x-default", href: "https://tryhirly.com/blog" },
    ]);
  });
});
