/**
 * Single source of truth for the product name + taglines.
 */
export const BRAND = {
  NAME: "Hirly",
  TAGLINE: "Swipe jobs. Match careers. Get hired.",
  TAGLINE_SHORT: "Swipe jobs. Get hired.",
  CTA: "Continue with Google",
  CTA_PRIMARY: "Start Swiping Jobs",
  CTA_SECONDARY: "Get Hired Today",
  SUPPORT_EMAIL: "app@tryhirly.com",
};

export const supportMailto = (subject = "") => {
  const base = `mailto:${BRAND.SUPPORT_EMAIL}`;
  if (!subject) return base;
  return `${base}?subject=${encodeURIComponent(subject)}`;
};
