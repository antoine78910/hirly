export const MOBILE_THEME_STORAGE_KEY = "swiipr_theme";

export function readMobileTheme() {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(MOBILE_THEME_STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch (_) {
    return "light";
  }
}

export function applyMobileTheme(theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("sprout-dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function saveMobileTheme(theme) {
  if (typeof window === "undefined") return "light";
  const normalized = theme === "dark" ? "dark" : "light";
  try {
    window.localStorage.setItem(MOBILE_THEME_STORAGE_KEY, normalized);
  } catch (_) {}
  applyMobileTheme(normalized);
  window.dispatchEvent(new CustomEvent("mobile-theme-change", { detail: normalized }));
  return normalized;
}

export function mobileThemeLabel(theme, t) {
  return theme === "dark" ? t("settings.themeDark") : t("settings.themeLight");
}
