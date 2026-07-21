import {
  getLandingHeroHighlightWidthCh,
  getLandingHeroHeadline,
  getLandingHeroJobLabel,
  getLandingHeroRotatingLabels,
  getLandingHeroBullets,
  getLandingHeroCta,
  getLandingHeroSubtitle,
  resolveLandingContractFromLocation,
  resolveLandingContractType,
} from "./landingHeroCopy";

describe("landingHeroCopy", () => {
  it("maps contract aliases", () => {
    expect(resolveLandingContractType("stage")).toBe("internship");
    expect(resolveLandingContractType("CDI")).toBe("permanent");
    expect(resolveLandingContractType("job-ete")).toBe("summer_job");
  });

  it("reads contract type from landing path slugs", () => {
    const params = new URLSearchParams();
    expect(resolveLandingContractFromLocation("/stage", params)).toBe("internship");
    expect(resolveLandingContractFromLocation("/alternance", params)).toBe("apprenticeship");
    expect(resolveLandingContractFromLocation("/fr/cdi", params)).toBe("permanent");
    expect(resolveLandingContractFromLocation("/de/cdi", params)).toBe("permanent");
    expect(resolveLandingContractFromLocation("/es/stage", params)).toBe("internship");
    expect(resolveLandingContractFromLocation("/it/alternance", params)).toBe("apprenticeship");
    expect(resolveLandingContractFromLocation("/", params)).toBeNull();
  });

  it("builds French headlines per contract type", () => {
    expect(getLandingHeroJobLabel("fr", "internship")).toBe("stage");
    expect(getLandingHeroJobLabel("fr", "permanent")).toBe("CDI");
    expect(getLandingHeroRotatingLabels("fr")).toEqual([
      "emploi",
      "CDI",
      "CDD",
      "stage",
      "alternance",
      "job d'été",
      "saisonnier",
    ]);
    expect(getLandingHeroHighlightWidthCh("fr")).toBeGreaterThan(10);
    expect(getLandingHeroHeadline("fr", "apprenticeship")).toEqual({
      line1Prefix: "Trouve ton ",
      line2: "sans passer des heures",
      line3Prefix: "à ",
      accent: "postuler.",
    });
  });

  it.each([
    ["de", "ein Praktikum", "Finde ", "Finde jetzt ein Praktikum"],
    ["es", "plaza de prácticas", "Encuentra tu ", "Encuentra tu plaza de prácticas ahora"],
    ["it", "tirocinio", "Trova il tuo ", "Trova il tuo tirocinio ora"],
  ])("uses authored %s landing copy without EN/FR fallback", (locale, internship, line1Prefix, cta) => {
    expect(getLandingHeroJobLabel(locale, "internship")).toBe(internship);
    expect(getLandingHeroHeadline(locale).line1Prefix).toBe(line1Prefix);
    expect(getLandingHeroCta(locale, "internship")).toBe(cta);
    expect(getLandingHeroSubtitle(locale)).not.toBe(getLandingHeroSubtitle("en"));
    expect(getLandingHeroSubtitle(locale)).not.toBe(getLandingHeroSubtitle("fr"));
    expect(getLandingHeroBullets(locale)).not.toEqual(getLandingHeroBullets("en"));
    expect(getLandingHeroBullets(locale)).not.toEqual(getLandingHeroBullets("fr"));
  });

  it("supports regional DE/ES/IT locale values", () => {
    expect(getLandingHeroJobLabel("de-DE", "internship")).toBe("ein Praktikum");
    expect(getLandingHeroJobLabel("es-ES", "internship")).toBe("plaza de prácticas");
    expect(getLandingHeroJobLabel("it-IT", "internship")).toBe("tirocinio");
  });
});
