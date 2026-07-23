import { getTrainingFaq } from "./trainingFaq";

describe("training FAQ translations", () => {
  test("provides matching English and French questions without falling back to French", () => {
    const english = getTrainingFaq("en");
    const french = getTrainingFaq("fr-FR");

    expect(english.map((item) => item.id)).toEqual(french.map((item) => item.id));
    expect(english).toHaveLength(french.length);
    expect(english[0].question).toBe("How do I get Pro access?");
    expect(english[0].question).not.toBe(french[0].question);
    expect(english.every((item) => item.question && item.answer.length > 0)).toBe(true);
    expect(french.every((item) => item.question && item.answer.length > 0)).toBe(true);
  });
});
