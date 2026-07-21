import fs from "fs";
import path from "path";

const readSource = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), "src", relativePath), "utf8");

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
    requiredMarkers: ["locale === \"de\"", "locale === \"es\"", "locale === \"it\""],
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

describe("migrated landing locale static guard", () => {
  it.each(MIGRATED_LANDING_LOCALE_MODULES)(
    "keeps $path out of an EN/FR-only locale selector",
    ({ path: relativePath, requiredMarkers }) => {
      const source = readSource(relativePath);

      requiredMarkers.forEach((marker) => {
        expect(source).toContain(marker);
      });
    }
  );
});
