/** Safe in-app return path after sign-in (blocks open redirects). */
export function resolveAuthReturnPath(raw, fallback = "/swipe") {
  if (!raw || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
}
