import { buildProfileWelcomeItems, getOnboardingValueTagline } from "./onboardingData";

describe("localized onboarding welcome copy", () => {
  const expected = {
    de: {
      titles: [
        "Bring deine Karriere voran",
        "Bewirb dich in Lichtgeschwindigkeit",
        "Sichere dir deinen nächsten Erfolg",
      ],
      primaryRole: "deine Zielpositionen",
      industryHint: "Top-Unternehmen",
      tagline: "2× mehr Vorstellungsgespräche. 5× weniger Aufwand.",
    },
    es: {
      titles: [
        "Impulsa tu carrera",
        "Solicita empleo a toda velocidad",
        "Consigue tu próximo logro",
      ],
      primaryRole: "tus puestos objetivo",
      industryHint: "las mejores empresas",
      tagline: "2× más entrevistas. 5× menos esfuerzo.",
    },
    it: {
      titles: [
        "Fai crescere la tua carriera",
        "Candidati alla velocità della luce",
        "Conquista il tuo prossimo traguardo",
      ],
      primaryRole: "i tuoi ruoli ideali",
      industryHint: "le migliori aziende",
      tagline: "2× più colloqui. 5× meno impegno.",
    },
  };

  it.each(Object.entries(expected))(
    "uses explicit %s welcome copy, placeholders, and tagline",
    (locale, copy) => {
      const items = buildProfileWelcomeItems({ lang: locale, salaryMin: 50_000 });

      expect(items.map(({ title }) => title)).toEqual(copy.titles);
      expect(items[1].body).toContain(copy.primaryRole);
      expect(items[2].body).toContain(copy.industryHint);
      expect(getOnboardingValueTagline(locale)).toBe(copy.tagline);

      if (locale === "es" || locale === "it") {
        expect(items[0].body).toMatch(/€50,000\+\.$/);
        expect(items[0].body).not.toContain("+ .");
      }
    },
  );

  it.each([
    ["DE-de", "de"],
    ["es-MX", "es"],
    ["IT-it", "it"],
  ])("normalizes %s to its %s onboarding catalog", (regionalLocale, baseLocale) => {
    const regional = buildProfileWelcomeItems({ lang: regionalLocale });
    const base = buildProfileWelcomeItems({ lang: baseLocale });

    expect(regional).toEqual(base);
    expect(getOnboardingValueTagline(regionalLocale)).toBe(getOnboardingValueTagline(baseLocale));
  });
});
