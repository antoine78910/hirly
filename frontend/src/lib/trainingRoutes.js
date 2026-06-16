export const TRAINING_LOCALES = ["en", "fr"];

export function isTrainingLocale(value) {
  return TRAINING_LOCALES.includes(value);
}

export function isTrainingRoute(pathname) {
  if (pathname === "/training" || pathname.startsWith("/training/")) return true;
  return TRAINING_LOCALES.some(
    (loc) => pathname === `/${loc}/training` || pathname.startsWith(`/${loc}/training/`),
  );
}

export function parseTrainingLocale(pathname) {
  const match = pathname.match(/^\/(en|fr)\/training(?:\/|$)/);
  return match ? match[1] : null;
}

export function storedTrainingLocale() {
  if (typeof window === "undefined") return "en";
  return localStorage.getItem("hirly_training_lang") === "fr" ? "fr" : "en";
}

export function trainingPath(locale, ...segments) {
  const loc = isTrainingLocale(locale) ? locale : "en";
  const rest = segments.filter(Boolean).join("/");
  return rest ? `/${loc}/training/${rest}` : `/${loc}/training`;
}

export function trainingCoursePath(locale, courseId) {
  if (!isTrainingLocale(locale)) {
    return courseId ? `/training/${courseId}` : "/training";
  }
  return trainingPath(locale, courseId);
}

export function trainingHubPath(locale) {
  return isTrainingLocale(locale) ? trainingPath(locale) : "/training";
}

export function trainingModulePath(locale, courseId, moduleId) {
  const base = trainingCoursePath(locale, courseId);
  return moduleId ? `${base}?module=${encodeURIComponent(moduleId)}` : base;
}

export function replaceTrainingLocale(pathname, search, nextLocale) {
  const loc = isTrainingLocale(nextLocale) ? nextLocale : "en";
  if (pathname.match(/^\/(en|fr)\/training/)) {
    return pathname.replace(/^\/(en|fr)/, `/${loc}`) + (search || "");
  }
  if (pathname === "/training") return trainingPath(loc) + (search || "");
  const courseMatch = pathname.match(/^\/training\/([^/]+)$/);
  if (courseMatch) return trainingPath(loc, courseMatch[1]) + (search || "");
  return trainingPath(loc) + (search || "");
}

export function legacyTrainingRedirect(pathname, search) {
  const locale = storedTrainingLocale();
  if (pathname === "/training") return trainingPath(locale) + (search || "");
  if (pathname === "/training/creator") return trainingPath(locale, "creator") + (search || "");
  const courseMatch = pathname.match(/^\/training\/([^/]+)$/);
  if (courseMatch) return trainingPath(locale, courseMatch[1]) + (search || "");
  return trainingPath(locale) + (search || "");
}
