import { filterPhoneCountries, getDefaultPhonePrefix, getCountryLabel } from "./phoneCountryCodes";

describe("phoneCountryCodes", () => {
  it("returns locale defaults", () => {
    expect(getDefaultPhonePrefix("fr")).toBe("+33");
    expect(getDefaultPhonePrefix("en")).toBe("+1");
  });

  it("filters countries by name or dial code", () => {
    const frMatches = filterPhoneCountries("france", "fr");
    expect(frMatches.some((country) => country.iso2 === "FR")).toBe(true);

    const usMatches = filterPhoneCountries("+1", "en");
    expect(usMatches.some((country) => country.iso2 === "US")).toBe(true);
  });

  it("localizes country labels", () => {
    expect(getCountryLabel("FR", "fr")).toMatch(/france/i);
  });
});
