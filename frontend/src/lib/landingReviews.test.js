import {
  getLandingReviewColumns,
  getLandingReviewsAll,
  getLandingReviewsCopy,
} from "./landingReviews";

describe("landing reviews localization", () => {
  it.each([
    ["de", "Echte Bewertungen. Echte Menschen."],
    ["es", "Opiniones reales. Personas reales."],
    ["it", "Recensioni vere. Persone vere."],
  ])("uses authored %s review copy and all review cards", (locale, badge) => {
    expect(getLandingReviewsCopy(locale).badge).toBe(badge);
    expect(getLandingReviewColumns(locale)).toHaveLength(2);
    expect(getLandingReviewsAll(locale)).toHaveLength(14);
    const localizedVerifiedReview = getLandingReviewsAll(locale).find(({ id }) => id === "verified");
    const englishVerifiedReview = getLandingReviewsAll("en").find(({ id }) => id === "verified");
    expect(localizedVerifiedReview.name).not.toBe(englishVerifiedReview.name);
    expect(localizedVerifiedReview).toMatchObject({
      subline: englishVerifiedReview.subline,
      quote: englishVerifiedReview.quote,
    });
  });

  it("normalizes regional locales and uses English only for unsupported locales", () => {
    expect(getLandingReviewsCopy("de-DE")).toEqual(getLandingReviewsCopy("de"));
    expect(getLandingReviewsCopy("es-ES")).toEqual(getLandingReviewsCopy("es"));
    expect(getLandingReviewsCopy("it-IT")).toEqual(getLandingReviewsCopy("it"));
    expect(getLandingReviewsAll("pt-BR")).toEqual(getLandingReviewsAll("en"));
  });

  it.each(["de", "es", "it"])("keeps %s testimonial quotes and sublines verbatim", (locale) => {
    const englishReviews = getLandingReviewsAll("en");
    expect(getLandingReviewsAll(locale).map(({ subline, quote }) => ({ subline, quote }))).toEqual(
      englishReviews.map(({ subline, quote }) => ({ subline, quote }))
    );
  });
});
