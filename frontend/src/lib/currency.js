import { readStoredAppLang } from "./appUi";

export const APP_CURRENCY = "EUR";

export function moneyLocale(lang) {
  return lang === "fr" ? "fr-FR" : "en-IE";
}

/** Full amount with currency symbol (e.g. €19.99, 19,99 €). */
export function formatMoney(amount, lang = readStoredAppLang()) {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat(moneyLocale(lang), {
    style: "currency",
    currency: APP_CURRENCY,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Salary / filter labels — compact for large values (e.g. €250k+, 250 k €+). */
export function formatMinSalary(value, lang = readStoredAppLang()) {
  const n = Number(value) || 0;
  if (n >= 250_000) {
    return `${formatCompactMoney(250_000, lang)}+`;
  }
  if (n >= 1_000) {
    return formatCompactMoney(n, lang);
  }
  return formatMoney(n, lang);
}

export function formatCompactMoney(value, lang = readStoredAppLang()) {
  const n = Number(value) || 0;
  const k = Math.round(n / 1000);
  if (lang === "fr") {
    return `${k} k €`;
  }
  return `€${k}k`;
}

/** Per-application unit price (2–3 decimal places). */
export function formatUnitMoney(amount, lang = readStoredAppLang()) {
  const value = Number(amount) || 0;
  const fractionDigits = value > 0 && value < 0.1 ? 3 : 2;
  return new Intl.NumberFormat(moneyLocale(lang), {
    style: "currency",
    currency: APP_CURRENCY,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Alias used in onboarding copy. */
export function formatSalary(value, lang = readStoredAppLang()) {
  return formatMoney(value, lang);
}
