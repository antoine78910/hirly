import { getDefaultPhonePrefix, resolveCountryByDial } from "./phoneCountryCodes";
import {
  formatDigitsWithGroups,
  formatLocalPhoneDisplay,
  getDefaultPhoneCountry,
  getPhoneLocalFormat,
  isValidLocalPhoneLength,
} from "./phoneLocalFormats";

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidContactPhone(localValue, iso2, dial) {
  return isValidLocalPhoneLength(localValue, iso2, dial);
}

export function formatContactPhone(prefix, localValue, iso2) {
  const localDigits = digitsOnly(localValue);
  if (!localDigits) return "";
  const code = String(prefix || "").trim() || getDefaultPhonePrefix("fr");
  const format = getPhoneLocalFormat(iso2, code);
  const grouped = formatDigitsWithGroups(localDigits, format.groups);
  return `${code} ${grouped}`.trim();
}

export function parseStoredContactPhone(phone, lang = "fr") {
  const raw = String(phone || "").trim();
  const fallback = getDefaultPhoneCountry(lang);
  if (!raw) {
    return { prefix: fallback.dial, iso2: fallback.iso2, local: "" };
  }

  const match = raw.match(/^(\+\d{1,4})\s*(.*)$/);
  if (match) {
    const prefix = match[1];
    const country = resolveCountryByDial(prefix, lang);
    const iso2 = country?.iso2 || fallback.iso2;
    const digits = digitsOnly(match[2]);
    return {
      prefix,
      iso2,
      local: formatLocalPhoneDisplay(digits, iso2, prefix),
    };
  }

  return {
    prefix: fallback.dial,
    iso2: fallback.iso2,
    local: formatLocalPhoneDisplay(raw, fallback.iso2, fallback.dial),
  };
}
