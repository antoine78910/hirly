export const AI_SETTINGS_STORAGE_KEY = "hirly.ai.settings.v1";

export const DEFAULT_AI_SETTINGS = {
  aiCoverLetter: true,
  aiResume: true,
  reviewDocuments: true,
  findResumeGaps: true,
};

export function readAiSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw);
    const { demoAccount: _removed, ...rest } = parsed;
    return { ...DEFAULT_AI_SETTINGS, ...rest };
  } catch (_) {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    const { demoAccount: _removed, ...rest } = settings;
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(rest));
    window.dispatchEvent(new CustomEvent("hirly:ai-settings-changed"));
  } catch (_) {}
}
