import { TUTORIAL_BYPASS_AUTH } from "./dev";

export const DEMO_SETTINGS_STORAGE_KEY = "hirly.demo.settings.v1";
export const DEMO_SETTINGS_CHANGED = "hirly:demo-settings-changed";

export const DEFAULT_DEMO_SETTINGS = {
  financeJobFeed: false,
};

let demoSettingsEligible = false;

/** Demo feed toggles (Paris finance) — available on demo accounts and admin accounts. */
export function setFinanceDemoEligibility(isDemoAccount, isAdmin = false) {
  demoSettingsEligible = Boolean(isDemoAccount) || Boolean(isAdmin);
}

export function readDemoSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_DEMO_SETTINGS };
  try {
    const raw = window.localStorage.getItem(DEMO_SETTINGS_STORAGE_KEY);
    const merged = raw
      ? { ...DEFAULT_DEMO_SETTINGS, ...JSON.parse(raw) }
      : { ...DEFAULT_DEMO_SETTINGS };
    if (TUTORIAL_BYPASS_AUTH && demoSettingsEligible) {
      merged.financeJobFeed = true;
    }
    return merged;
  } catch {
    return { ...DEFAULT_DEMO_SETTINGS };
  }
}

export function saveDemoSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(DEMO_SETTINGS_CHANGED, { detail: settings }));
  } catch {
    /* ignore */
  }
}

export function isFinanceDemoEnabled() {
  if (!demoSettingsEligible) return false;
  return Boolean(readDemoSettings().financeJobFeed);
}

/** Clear demo-only feed settings when switching to a normal account. */
export function resetDemoOnlySettings() {
  saveDemoSettings({ ...DEFAULT_DEMO_SETTINGS });
}

/** Local/demo feeds — swipes should simulate apply, never hit real generation. */
export function isDemoSwipeMode() {
  return isFinanceDemoEnabled();
}
