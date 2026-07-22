import { getLandingFeaturesCopy } from "./landingFeatures";

describe("getLandingFeaturesCopy", () => {
  it.each([
    ["de", "Entdecke Hirly", "Deine Jobsuche, überall dabei.", "Deine Bewerbung wurde versendet!"],
    [
      "es",
      "Descubre Hirly",
      "Tu búsqueda de empleo, siempre contigo.",
      "¡Tu candidatura se ha enviado!",
    ],
    [
      "it",
      "Scopri Hirly",
      "La tua ricerca di lavoro, sempre con te.",
      "La tua candidatura è stata inviata!",
    ],
  ])("uses an explicit authored %s catalog", (locale, badge, title, aiApplySuccess) => {
    const copy = getLandingFeaturesCopy(locale);
    expect(copy).toMatchObject({ badge, title, aiApplySuccess });
    expect(copy.features).toHaveLength(3);
    expect(copy.highlights).toHaveLength(8);
    expect(copy.trackerCards).toHaveLength(4);
    expect(copy).not.toEqual(getLandingFeaturesCopy("en"));
    expect(copy).not.toEqual(getLandingFeaturesCopy("fr"));
  });

  it("normalizes regional locale values without falling back", () => {
    expect(getLandingFeaturesCopy("fr-FR").badge).toBe("Découvrez Hirly");
    expect(getLandingFeaturesCopy("de-DE").badge).toBe("Entdecke Hirly");
    expect(getLandingFeaturesCopy("es-ES").badge).toBe("Descubre Hirly");
    expect(getLandingFeaturesCopy("it-IT").badge).toBe("Scopri Hirly");
  });

  it.each([
    ["de", ["Vorstellungsgespräch", "Beworben", "Angebot", "Ausstehend"]],
    ["es", ["Entrevista", "Solicitud enviada", "Oferta", "Pendiente"]],
    ["it", ["Colloquio", "Candidatura inviata", "Offerta", "In attesa"]],
  ])("translates visible %s tracker-card statuses", (locale, statuses) => {
    expect(getLandingFeaturesCopy(locale).trackerCards.map((card) => card.status)).toEqual(
      statuses,
    );
  });

  it("retains English as the fallback only for unsupported locales", () => {
    expect(getLandingFeaturesCopy("pt-BR")).toEqual(getLandingFeaturesCopy("en"));
  });
});
