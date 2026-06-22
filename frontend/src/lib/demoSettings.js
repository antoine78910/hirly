import { TUTORIAL_BYPASS_AUTH } from "./dev";

export const DEMO_SETTINGS_STORAGE_KEY = "hirly.demo.settings.v1";
export const DEMO_SETTINGS_CHANGED = "hirly:demo-settings-changed";

export const DEFAULT_DEMO_SETTINGS = {
  financeJobFeed: TUTORIAL_BYPASS_AUTH,
};

export function readDemoSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_DEMO_SETTINGS };
  try {
    const raw = window.localStorage.getItem(DEMO_SETTINGS_STORAGE_KEY);
    const merged = raw
      ? { ...DEFAULT_DEMO_SETTINGS, ...JSON.parse(raw) }
      : { ...DEFAULT_DEMO_SETTINGS };
    if (TUTORIAL_BYPASS_AUTH) {
      merged.financeJobFeed = true;
    }
    return merged;
  } catch {
    return { ...DEFAULT_DEMO_SETTINGS, financeJobFeed: TUTORIAL_BYPASS_AUTH || false };
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
  return Boolean(readDemoSettings().financeJobFeed);
}
