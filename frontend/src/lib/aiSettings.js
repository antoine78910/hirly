export const AI_SETTINGS_STORAGE_KEY = "hirly.ai.settings.v1";
const AI_SETTINGS_SCHEMA_VERSION = 3;

export const AI_SETTING_TOGGLES = [
  "aiCoverLetter",
  "aiResume",
  "reviewDocuments",
  "findResumeGaps",
];

export const DEFAULT_AI_SETTINGS = {
  aiCoverLetter: true,
  aiResume: true,
  reviewDocuments: true,
  findResumeGaps: true,
  settingsVersion: AI_SETTINGS_SCHEMA_VERSION,
};

function applyEnabledAiDefaults(settings) {
  for (const key of AI_SETTING_TOGGLES) {
    settings[key] = true;
  }
  settings.settingsVersion = AI_SETTINGS_SCHEMA_VERSION;
  return settings;
}

export function readAiSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw);
    const { demoAccount: _removed, ...rest } = parsed;
    const merged = { ...DEFAULT_AI_SETTINGS, ...rest };
    if ((merged.settingsVersion || 1) < AI_SETTINGS_SCHEMA_VERSION) {
      applyEnabledAiDefaults(merged);
      saveAiSettings(merged);
    }
    return merged;
  } catch (_) {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    const { demoAccount: _removed, ...rest } = settings;
    window.localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...rest,
        settingsVersion: rest.settingsVersion || AI_SETTINGS_SCHEMA_VERSION,
      }),
    );
    window.dispatchEvent(new CustomEvent("hirly:ai-settings-changed"));
  } catch (_) {}
}
