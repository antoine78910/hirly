import { TUTORIAL_BYPASS_AUTH } from "./dev";

export const DEMO_SETTINGS_STORAGE_KEY = "hirly.demo.settings.v1";
export const DEMO_SETTINGS_CHANGED = "hirly:demo-settings-changed";

export const DEFAULT_DEMO_SETTINGS = {
  financeJobFeed: false,
  financeJobFeedConfigured: false,
};

let demoSettingsEligible = false;
let isDemoAccountEligible = false;

/** Demo feed toggles (Paris finance) — available on demo accounts and admin accounts. */
export function setFinanceDemoEligibility(isDemoAccount, isAdmin = false) {
  demoSettingsEligible = Boolean(isDemoAccount) || Boolean(isAdmin);
  isDemoAccountEligible = Boolean(isDemoAccount);
}

export function readDemoSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_DEMO_SETTINGS };
  try {
    const raw = window.localStorage.getItem(DEMO_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const merged = { ...DEFAULT_DEMO_SETTINGS, ...(parsed || {}) };
    if (isDemoAccountEligible && !merged.financeJobFeedConfigured) {
      merged.financeJobFeed = true;
    }
    if (TUTORIAL_BYPASS_AUTH && demoSettingsEligible) {
      merged.financeJobFeed = true;
    }
    return merged;
  } catch {
    return { ...DEFAULT_DEMO_SETTINGS };
  }
}

/** Demo accounts start with the Paris finance feed until the user turns it off in settings. */
export function ensureDemoFinanceFeedDefault() {
  if (!isDemoAccountEligible || typeof window === "undefined") return;
  const settings = readDemoSettings();
  if (settings.financeJobFeedConfigured) return;
  if (settings.financeJobFeed) return;
  saveDemoSettings({ ...settings, financeJobFeed: true, financeJobFeedConfigured: false });
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
