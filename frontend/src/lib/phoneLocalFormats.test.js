import {
  formatLocalPhoneDisplay,
  getPhoneLocalFormat,
  getPhonePlaceholder,
  isValidLocalPhoneLength,
} from "./phoneLocalFormats";

describe("phoneLocalFormats", () => {
  it("formats French numbers with 2-digit groups", () => {
    expect(formatLocalPhoneDisplay("612345678", "FR", "+33")).toBe("6 12 34 56 78");
    expect(getPhonePlaceholder("FR", "+33")).toBe("6 12 34 56 78");
  });

  it("formats US numbers as 3-3-4", () => {
    expect(formatLocalPhoneDisplay("5551234567", "US", "+1")).toBe("555 123 4567");
  });

  it("limits input to the country max length", () => {
    expect(formatLocalPhoneDisplay("612345678901234", "FR", "+33")).toBe("6 12 34 56 78");
    expect(isValidLocalPhoneLength("612345678901234", "FR", "+33")).toBe(false);
  });

  it("uses dial fallback when iso2 is unknown", () => {
    const format = getPhoneLocalFormat(null, "+33");
    expect(format.maxDigits).toBe(9);
  });
});
