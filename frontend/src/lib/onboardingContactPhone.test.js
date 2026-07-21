import {
  formatContactPhone,
  isValidContactPhone,
  parseStoredContactPhone,
} from "./onboardingContactPhone";

describe("onboardingContactPhone", () => {
  it("validates local phone length per country", () => {
    expect(isValidContactPhone("612345678", "FR", "+33")).toBe(true);
    expect(isValidContactPhone("61234567", "FR", "+33")).toBe(false);
    expect(isValidContactPhone("5551234567", "US", "+1")).toBe(true);
    expect(isValidContactPhone("555123456", "US", "+1")).toBe(false);
  });

  it("formats phone with country-specific spacing", () => {
    expect(formatContactPhone("+33", "612345678", "FR")).toBe("+33 6 12 34 56 78");
    expect(formatContactPhone("+1", "5551234567", "US")).toBe("+1 555 123 4567");
  });

  it("parses stored phone numbers", () => {
    expect(parseStoredContactPhone("+33 6 12 34 56 78", "fr")).toEqual({
      prefix: "+33",
      iso2: "FR",
      local: "6 12 34 56 78",
    });
  });
});
