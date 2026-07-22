/** National number length + display grouping (without trunk prefix 0). */

const DEFAULT_FORMAT = {
  minDigits: 8,
  maxDigits: 10,
  groups: [3, 3, 4],
  example: "123 456 7890",
};

const NANP_FORMAT = {
  minDigits: 10,
  maxDigits: 10,
  groups: [3, 3, 4],
  example: "555 123 4567",
};

const ISO2_FORMATS = {
  FR: { minDigits: 9, maxDigits: 9, groups: [1, 2, 2, 2, 2], example: "6 12 34 56 78" },
  US: { ...NANP_FORMAT },
  CA: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "416 555 0123" },
  GB: { minDigits: 10, maxDigits: 10, groups: [4, 3, 3], example: "7911 123 456" },
  IE: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "85 123 4567" },
  DE: { minDigits: 10, maxDigits: 11, groups: [3, 3, 4], example: "151 234 5678" },
  AT: { minDigits: 10, maxDigits: 11, groups: [3, 3, 4], example: "664 123 4567" },
  CH: { minDigits: 9, maxDigits: 9, groups: [2, 3, 2, 2], example: "79 123 45 67" },
  BE: { minDigits: 9, maxDigits: 9, groups: [3, 2, 2, 2], example: "470 12 34 56" },
  LU: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "621 123 456" },
  NL: { minDigits: 9, maxDigits: 9, groups: [1, 2, 2, 2, 2], example: "6 12 34 56 78" },
  ES: { minDigits: 9, maxDigits: 9, groups: [3, 2, 2, 2], example: "612 34 56 78" },
  PT: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "912 345 678" },
  IT: { minDigits: 9, maxDigits: 10, groups: [3, 3, 4], example: "312 345 6789" },
  MC: { minDigits: 8, maxDigits: 8, groups: [2, 2, 2, 2], example: "6 12 34 56" },
  AD: { minDigits: 6, maxDigits: 6, groups: [3, 3], example: "312 345" },
  PL: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "512 345 678" },
  CZ: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "601 234 567" },
  SK: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "912 345 678" },
  HU: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "20 123 4567" },
  RO: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "712 345 678" },
  BG: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "888 123 456" },
  GR: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "691 234 5678" },
  HR: { minDigits: 8, maxDigits: 9, groups: [2, 3, 4], example: "91 234 5678" },
  SI: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "31 234 567" },
  RS: { minDigits: 8, maxDigits: 9, groups: [2, 3, 4], example: "60 123 4567" },
  BA: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "61 234 567" },
  ME: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "67 234 567" },
  MK: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "70 123 456" },
  AL: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "67 212 3456" },
  SE: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "70 123 4567" },
  NO: { minDigits: 8, maxDigits: 8, groups: [3, 2, 3], example: "412 34 567" },
  DK: { minDigits: 8, maxDigits: 8, groups: [2, 2, 2, 2], example: "12 34 56 78" },
  FI: { minDigits: 9, maxDigits: 10, groups: [2, 3, 4], example: "41 234 5678" },
  IS: { minDigits: 7, maxDigits: 7, groups: [3, 4], example: "611 2345" },
  EE: { minDigits: 7, maxDigits: 8, groups: [3, 4], example: "5123 4567" },
  LV: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "21 234 567" },
  LT: { minDigits: 8, maxDigits: 8, groups: [3, 5], example: "612 34567" },
  UA: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "50 123 4567" },
  BY: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "29 123 4567" },
  MD: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "69 123 456" },
  RU: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "912 345 6789" },
  KZ: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "701 234 5678" },
  TR: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "532 123 4567" },
  MA: { minDigits: 9, maxDigits: 9, groups: [3, 2, 2, 2], example: "612 34 56 78" },
  DZ: { minDigits: 9, maxDigits: 9, groups: [3, 2, 2, 2], example: "551 23 45 67" },
  TN: { minDigits: 8, maxDigits: 8, groups: [2, 3, 3], example: "20 123 456" },
  SN: { minDigits: 9, maxDigits: 9, groups: [2, 3, 2, 2], example: "77 123 45 67" },
  CI: { minDigits: 8, maxDigits: 10, groups: [2, 2, 2, 2, 2], example: "07 12 34 56 78" },
  CM: { minDigits: 9, maxDigits: 9, groups: [3, 2, 2, 2], example: "671 23 45 67" },
  NG: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "803 123 4567" },
  ZA: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "82 123 4567" },
  EG: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "100 123 4567" },
  KE: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "712 345 678" },
  GH: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "24 123 4567" },
  AE: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "50 123 4567" },
  SA: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "50 123 4567" },
  IL: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "50 123 4567" },
  IN: { minDigits: 10, maxDigits: 10, groups: [5, 5], example: "98765 43210" },
  PK: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "301 234 5678" },
  BD: { minDigits: 10, maxDigits: 10, groups: [4, 6], example: "1712 345678" },
  CN: { minDigits: 11, maxDigits: 11, groups: [3, 4, 4], example: "131 2345 6789" },
  JP: { minDigits: 10, maxDigits: 10, groups: [2, 4, 4], example: "90 1234 5678" },
  KR: { minDigits: 10, maxDigits: 10, groups: [2, 4, 4], example: "10 1234 5678" },
  HK: { minDigits: 8, maxDigits: 8, groups: [4, 4], example: "9123 4567" },
  SG: { minDigits: 8, maxDigits: 8, groups: [4, 4], example: "9123 4567" },
  MY: { minDigits: 9, maxDigits: 10, groups: [2, 3, 4], example: "12 345 6789" },
  TH: { minDigits: 9, maxDigits: 9, groups: [2, 3, 4], example: "81 234 5678" },
  VN: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "912 345 678" },
  PH: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "917 123 4567" },
  ID: { minDigits: 10, maxDigits: 11, groups: [3, 4, 4], example: "812 3456 7890" },
  AU: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "412 345 678" },
  NZ: { minDigits: 9, maxDigits: 10, groups: [2, 3, 4], example: "21 123 4567" },
  BR: { minDigits: 10, maxDigits: 11, groups: [2, 5, 4], example: "11 91234 5678" },
  MX: { minDigits: 10, maxDigits: 10, groups: [2, 4, 4], example: "55 1234 5678" },
  AR: { minDigits: 10, maxDigits: 10, groups: [2, 4, 4], example: "11 2345 6789" },
  CL: { minDigits: 9, maxDigits: 9, groups: [1, 4, 4], example: "9 1234 5678" },
  CO: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "301 234 5678" },
  PE: { minDigits: 9, maxDigits: 9, groups: [3, 3, 3], example: "912 345 678" },
  DO: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "809 555 1234" },
  JM: { minDigits: 10, maxDigits: 10, groups: [3, 3, 4], example: "876 555 1234" },
};

const DIAL_FORMATS = {
  "+1": NANP_FORMAT,
  "+33": ISO2_FORMATS.FR,
  "+44": ISO2_FORMATS.GB,
  "+49": ISO2_FORMATS.DE,
  "+39": ISO2_FORMATS.IT,
  "+34": ISO2_FORMATS.ES,
  "+351": ISO2_FORMATS.PT,
  "+32": ISO2_FORMATS.BE,
  "+41": ISO2_FORMATS.CH,
  "+31": ISO2_FORMATS.NL,
  "+352": ISO2_FORMATS.LU,
  "+212": ISO2_FORMATS.MA,
  "+213": ISO2_FORMATS.DZ,
  "+216": ISO2_FORMATS.TN,
  "+221": ISO2_FORMATS.SN,
  "+225": ISO2_FORMATS.CI,
  "+91": ISO2_FORMATS.IN,
  "+86": ISO2_FORMATS.CN,
  "+81": ISO2_FORMATS.JP,
  "+82": ISO2_FORMATS.KR,
  "+61": ISO2_FORMATS.AU,
  "+55": ISO2_FORMATS.BR,
  "+52": ISO2_FORMATS.MX,
};

export function getPhoneLocalFormat(iso2, dial) {
  const code = String(iso2 || "").toUpperCase();
  if (code && ISO2_FORMATS[code]) return ISO2_FORMATS[code];
  const normalizedDial = String(dial || "").trim();
  if (normalizedDial && DIAL_FORMATS[normalizedDial]) return DIAL_FORMATS[normalizedDial];
  return DEFAULT_FORMAT;
}

export function formatDigitsWithGroups(digits, groups) {
  const clean = String(digits || "").replace(/\D/g, "");
  if (!clean) return "";

  const parts = [];
  let index = 0;
  for (const size of groups) {
    if (index >= clean.length) break;
    parts.push(clean.slice(index, index + size));
    index += size;
  }
  if (index < clean.length) {
    parts.push(clean.slice(index));
  }
  return parts.filter(Boolean).join(" ");
}

export function formatLocalPhoneDisplay(value, iso2, dial) {
  const format = getPhoneLocalFormat(iso2, dial);
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, format.maxDigits);
  return formatDigitsWithGroups(digits, format.groups);
}

export function getPhonePlaceholder(iso2, dial) {
  return getPhoneLocalFormat(iso2, dial).example;
}

export function isValidLocalPhoneLength(value, iso2, dial) {
  const format = getPhoneLocalFormat(iso2, dial);
  const length = String(value || "").replace(/\D/g, "").length;
  return length >= format.minDigits && length <= format.maxDigits;
}

export function getDefaultPhoneCountry(lang = "en") {
  return lang === "fr" ? { iso2: "FR", dial: "+33" } : { iso2: "US", dial: "+1" };
}
