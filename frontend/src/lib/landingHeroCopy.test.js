import {
  getLandingHeroHighlightWidthCh,
  getLandingHeroHeadline,
  getLandingHeroJobLabel,
  getLandingHeroRotatingLabels,
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
    expect(resolveLandingContractFromLocation("/", params)).toBeNull();
  });

  it("builds French headlines per contract type", () => {
    expect(getLandingHeroJobLabel("fr", "internship")).toBe("stage");
    expect(getLandingHeroJobLabel("fr", "permanent")).toBe("CDI");
    expect(getLandingHeroRotatingLabels("fr")).toEqual([
      "CDI",
      "CDD",
      "stage",
      "emploi",
      "job d'été",
      "alternance",
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
});
