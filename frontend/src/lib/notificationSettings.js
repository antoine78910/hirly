export const NOTIFICATION_SETTINGS_STORAGE_KEY = "hirly.notification.settings.v1";

export const NOTIFICATION_TOGGLES = [
  "verificationRequired",
  "applicationSubmitted",
  "applicationStatus",
  "companyReply",
  "interviewInvite",
  "rejectionUpdate",
  "offerUpdate",
];

export const DEFAULT_NOTIFICATION_SETTINGS = Object.fromEntries(
  NOTIFICATION_TOGGLES.map((key) => [key, true]),
);

export function readNotificationSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_NOTIFICATION_SETTINGS };
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

export function saveNotificationSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("hirly:notification-settings-changed"));
  } catch (_) {}
}

export function countEnabledNotifications(settings) {
  return NOTIFICATION_TOGGLES.filter((key) => settings[key]).length;
}
