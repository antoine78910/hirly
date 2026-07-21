import { APP_LANGUAGES, APP_UI, appT, isAppLanguage, readStoredAppLang } from "./appUi";

function leafEntries(value, path = []) {
  return Object.entries(value).flatMap(([key, child]) => (
    typeof child === "string"
      ? [[path.concat(key).join("."), child]]
      : leafEntries(child, path.concat(key))
  ));
}

describe("app UI locales", () => {
  test("provides complete translated catalogs for every supported locale", () => {
    const englishKeys = leafEntries(APP_UI.en).map(([key]) => key).sort();

    expect(APP_LANGUAGES).toEqual(["en", "fr", "de", "es", "it"]);
    for (const locale of APP_LANGUAGES) {
      expect(leafEntries(APP_UI[locale]).map(([key]) => key).sort()).toEqual(englishKeys);
      expect(appT(locale, "settings.languageTitle")).not.toBe("settings.languageTitle");
    }
  });

  test("preserves interpolation placeholders in translated copy", () => {
    for (const [key, english] of leafEntries(APP_UI.en)) {
      const placeholders = english.match(/\{[^{}]+\}/g) || [];
      for (const locale of APP_LANGUAGES) {
        const translated = appT(locale, key);
        for (const placeholder of placeholders) expect(translated).toContain(placeholder);
      }
    }
  });

  test("accepts stored DE, ES, and IT preferences", () => {
    for (const locale of ["de", "es", "it"]) {
      localStorage.setItem("hirly_app_lang", locale);
      expect(isAppLanguage(locale)).toBe(true);
      expect(readStoredAppLang()).toBe(locale);
    }
  });
});
