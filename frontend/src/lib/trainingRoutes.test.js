import {
  TRAINING_LOCALES,
  hasTrainingContent,
  isTrainingRoute,
  parseTrainingLocale,
  replaceTrainingLocale,
  trainingPath,
} from "./trainingRoutes";

describe("training locale routes", () => {
  test("recognizes all product locale prefixes without treating them as French", () => {
    expect(TRAINING_LOCALES).toEqual(["en", "fr", "de", "es", "it"]);
    for (const locale of TRAINING_LOCALES) {
      expect(isTrainingRoute(`/${locale}/training/course-1`)).toBe(true);
      expect(parseTrainingLocale(`/${locale}/training/course-1`)).toBe(locale);
      expect(trainingPath(locale, "course-1")).toBe(`/${locale}/training/course-1`);
    }
  });

  test("marks untranslated DE/ES/IT content as unavailable rather than falling back", () => {
    for (const locale of ["de", "es", "it"]) {
      expect(hasTrainingContent(locale)).toBe(false);
      expect(replaceTrainingLocale(`/${locale}/training/course-1`, "?tab=overview", locale))
        .toBe(`/${locale}/training/course-1?tab=overview`);
    }
    expect(hasTrainingContent("en")).toBe(true);
    expect(hasTrainingContent("fr")).toBe(true);
    expect(replaceTrainingLocale("/de/training", "", "pt")).toBeNull();
  });

  test("does not recognize arbitrary locale prefixes as supported training routes", () => {
    expect(isTrainingRoute("/pt/training/course-1")).toBe(false);
    expect(parseTrainingLocale("/pt/training/course-1")).toBeNull();
  });
});
