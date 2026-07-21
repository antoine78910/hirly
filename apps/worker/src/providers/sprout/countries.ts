export const SPROUT_COUNTRIES = {
  FR: { address: "France" },
  US: { address: "United States" },
  DE: { address: "Germany" },
  GB: { address: "United Kingdom" },
  CA: { address: "Canada" },
  AU: { address: "Australia" },
  IN: { address: "India" },
} as const;

export type SproutCountryCode = keyof typeof SPROUT_COUNTRIES;

export function sproutCountry(code: string): { code: SproutCountryCode; address: string } {
  const normalized = code.trim().toUpperCase();
  if (!(normalized in SPROUT_COUNTRIES)) {
    throw new Error("sprout_country_not_supported");
  }
  const typed = normalized as SproutCountryCode;
  return { code: typed, address: SPROUT_COUNTRIES[typed].address };
}
