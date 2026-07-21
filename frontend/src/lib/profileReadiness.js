import { isValidContactPhone, parseStoredContactPhone } from "./onboardingContactPhone";

export function profileHasResume(profile) {
  return Boolean(profile?.cv_text || profile?.cv_filename);
}

export function profileHasPhone(profile) {
  const raw = profile?.contact?.phone;
  if (!raw || !String(raw).trim()) return false;
  const parsed = parseStoredContactPhone(raw);
  return isValidContactPhone(parsed.local || raw, parsed.iso2, parsed.prefix);
}

export function isMissingResumeFeedError(message) {
  return typeof message === "string" && /upload cv first/i.test(message);
}

export function isMissingPhoneFeedError(message) {
  return typeof message === "string" && /phone number/i.test(message);
}
