export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidContactPhone(localValue) {
  return digitsOnly(localValue).length >= 8;
}

export function formatContactPhone(prefix, localValue) {
  const localDigits = digitsOnly(localValue);
  if (!localDigits) return "";
  const code = String(prefix || "").trim() || "+33";
  const grouped = localDigits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return `${code} ${grouped}`.trim();
}

export function parseStoredContactPhone(phone, lang = "fr") {
  const raw = String(phone || "").trim();
  const fallbackPrefix = lang === "fr" ? "+33" : "+1";
  if (!raw) return { prefix: fallbackPrefix, local: "" };

  const match = raw.match(/^(\+\d{1,4})\s*(.*)$/);
  if (match) {
    return {
      prefix: match[1],
      local: digitsOnly(match[2]).replace(/(\d{2})(?=\d)/g, "$1 ").trim(),
    };
  }
  return { prefix: fallbackPrefix, local: digitsOnly(raw).replace(/(\d{2})(?=\d)/g, "$1 ").trim() };
}
