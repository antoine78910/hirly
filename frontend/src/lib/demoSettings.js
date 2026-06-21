export const DEMO_SETTINGS_STORAGE_KEY = "hirly.demo.settings.v1";
export const DEMO_SETTINGS_CHANGED = "hirly:demo-settings-changed";

export const DEFAULT_DEMO_SETTINGS = {
  financeJobFeed: false,
};

export function readDemoSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_DEMO_SETTINGS };
  try {
    const raw = window.localStorage.getItem(DEMO_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEMO_SETTINGS };
    return { ...DEFAULT_DEMO_SETTINGS, ...JSON.parse(raw) };
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
  return Boolean(readDemoSettings().financeJobFeed);
}
