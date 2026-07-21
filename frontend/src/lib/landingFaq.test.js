import { getLandingFaq, getLandingFaqHeading } from "./landingFaq";

function faqShape(faq) {
  return faq.map(({ id, answer }) => ({
    id,
    answer: answer.map((block) => ({
      type: block.type,
      keys: Object.keys(block).sort(),
      partKeys: block.parts?.map((part) => Object.keys(part).sort()),
    })),
  }));
}

describe("landing FAQ localization", () => {
  const englishFaq = getLandingFaq("en");

  it.each([
    ["de", "1. Was ist Hirly?"],
    ["es", "1. ¿Qué es Hirly?"],
    ["it", "1. Che cos'è Hirly?"],
  ])("provides a complete, structure-compatible %s FAQ catalog", (locale, firstQuestion) => {
    const faq = getLandingFaq(locale);

    expect(faq).toHaveLength(8);
    expect(faq[0].question).toBe(firstQuestion);
    expect(faqShape(faq)).toEqual(faqShape(englishFaq));

    const supportLink = faq.find(({ id }) => id === "technical-issue").answer[0].parts[3];
    expect(supportLink).toEqual(
      englishFaq.find(({ id }) => id === "technical-issue").answer[0].parts[3]
    );
  });

  it("normalizes regional locales and falls back to English only for unsupported locales", () => {
    expect(getLandingFaq("de-DE")).toEqual(getLandingFaq("de"));
    expect(getLandingFaq("es-ES")).toEqual(getLandingFaq("es"));
    expect(getLandingFaq("it-IT")).toEqual(getLandingFaq("it"));
    expect(getLandingFaq("pt-BR")).toEqual(englishFaq);
  });

  it.each([
    ["de-DE", "Häufig gestellte Fragen"],
    ["es-ES", "Preguntas frecuentes"],
    ["it-IT", "Domande frequenti"],
    ["pt-BR", "Frequently asked questions"],
  ])("uses the locale-contract FAQ heading for %s", (locale, heading) => {
    expect(getLandingFaqHeading(locale)).toBe(heading);
  });
});
