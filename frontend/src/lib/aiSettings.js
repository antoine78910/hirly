export const AI_SETTINGS_STORAGE_KEY = "hirly.ai.settings.v1";

const defaultDemoAccount =
  typeof process !== "undefined"
  && process.env.NODE_ENV === "development"
  && process.env.REACT_APP_DEV_BYPASS_AUTH !== "false"
  && process.env.REACT_APP_DEMO_MODE !== "false";

export const DEFAULT_AI_SETTINGS = {
  aiCoverLetter: true,
  aiResume: true,
  reviewDocuments: true,
  findResumeGaps: true,
  /** Local-only applies: no backend submission, unlimited swipes, 600-credit display cycle. */
  demoAccount: defaultDemoAccount,
};

export function readAiSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AI_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("hirly:ai-settings-changed"));
  } catch (_) {}
}
