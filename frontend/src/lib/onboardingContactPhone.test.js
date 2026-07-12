import {
  formatContactPhone,
  isValidContactPhone,
  parseStoredContactPhone,
} from "./onboardingContactPhone";

describe("onboardingContactPhone", () => {
  it("validates local phone length", () => {
    expect(isValidContactPhone("612345678")).toBe(true);
    expect(isValidContactPhone("1234567")).toBe(false);
  });

  it("formats phone with prefix", () => {
    expect(formatContactPhone("+33", "612345678")).toBe("+33 61 23 45 67 8");
  });

  it("parses stored phone numbers", () => {
    expect(parseStoredContactPhone("+33 6 12 34 56 78", "fr")).toEqual({
      prefix: "+33",
      local: "61 23 45 67 8",
    });
  });
});
