import fs from "node:fs";
import path from "node:path";

const readSource = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), "src", relativePath), "utf8");

const EN_FR_ONLY_LOCALE_LIST =
  /\[\s*["']en["']\s*,\s*["']fr["']\s*\]|\[\s*["']fr["']\s*,\s*["']en["']\s*\]/;
const EN_FR_ONLY_LOCALE_CONDITIONAL = /\b(?:lang|locale|language)\s*===\s*["'](?:en|fr)["']\s*\?/;

function hasEnFrOnlyLocaleSelector(source) {
  return EN_FR_ONLY_LOCALE_LIST.test(source) || EN_FR_ONLY_LOCALE_CONDITIONAL.test(source);
}

// Deliberately narrow: these are the landing modules migrated to five-locale
// catalogs. Do not expand this into a repository-wide source scan.
const MIGRATED_LANDING_LOCALE_MODULES = [
  {
    path: "lib/landingHeroCopy.js",
    requiredMarkers: ["de:", "es:", "it:", 'new Set(["fr", "en", "de", "es", "it"])'],
  },
  {
    path: "lib/landingFeatures.js",
    requiredMarkers: ["de:", "es:", "it:"],
  },
  {
    path: "lib/landingReviews.js",
    requiredMarkers: ['locale === "de"', 'locale === "es"', 'locale === "it"'],
  },
  {
    path: "lib/landingFaq.js",
    requiredMarkers: ["FAQ_DE", "FAQ_ES", "FAQ_IT"],
  },
  {
    path: "components/landing/LandingLanguageSelector.jsx",
    requiredMarkers: ["APP_LANGUAGES.map"],
  },
];

// `pages/Landing.jsx` still contains inline EN/FR-only presentation branches.
// Owner: web-locale-migration. Rationale: its remaining inline copy has not
// yet moved into the five-locale landing catalogs, so it must not be reported
// as covered by this guard.
const TEMPORARY_EN_FR_ONLY_LANDING_ALLOWLIST = [
  {
    path: "pages/Landing.jsx",
    owner: "web-locale-migration",
    rationale: "Residual inline landing copy is pending catalog migration.",
  },
];

describe("migrated landing locale static guard", () => {
  it.each(MIGRATED_LANDING_LOCALE_MODULES)(
    "keeps $path out of an EN/FR-only locale selector",
    ({ path: relativePath, requiredMarkers }) => {
      const source = readSource(relativePath);

      requiredMarkers.forEach((marker) => {
        expect(source).toContain(marker);
      });

      expect(hasEnFrOnlyLocaleSelector(source)).toBe(false);
    },
  );

  it.each([
    ['const supportedLocales = ["en", "fr"];'],
    ["const supportedLocales = ['fr', 'en'];"],
    ['availableLanguages: [ "en", "fr" ]'],
    ["const title = lang === 'fr' ? 'Bonjour' : 'Hello';"],
    ['const title = lang === "en" ? "Hello" : "Bonjour";'],
  ])("rejects an EN/FR-only locale-selector fixture: %s", (fixture) => {
    expect(hasEnFrOnlyLocaleSelector(fixture)).toBe(true);
  });

  it("does not confuse a full five-locale selector with an EN/FR-only one", () => {
    expect(hasEnFrOnlyLocaleSelector('["en", "fr", "de", "es", "it"]')).toBe(false);
  });

  it("documents Landing.jsx as a temporary non-covered surface", () => {
    expect(TEMPORARY_EN_FR_ONLY_LANDING_ALLOWLIST).toEqual([
      expect.objectContaining({
        path: "pages/Landing.jsx",
        owner: expect.any(String),
        rationale: expect.any(String),
      }),
    ]);
    expect(
      MIGRATED_LANDING_LOCALE_MODULES.map(({ path: relativePath }) => relativePath),
    ).not.toContain("pages/Landing.jsx");
  });
});
