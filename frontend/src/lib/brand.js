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
  /** Primary support inbox — receive only, never used as a sender. */
  SUPPORT_EMAIL: "app@tryhirly.com",
  /** Outbound product alerts (application updates, interview invites, etc.). */
  NOTIFICATIONS_EMAIL: "notifications@tryhirly.com",
  /** Auth and other automated no-reply mail (Supabase SMTP). */
  NOREPLY_EMAIL: "noreply@tryhirly.com",
  SOCIAL_HANDLE: "tryhirly",
  INSTAGRAM_URL: "https://instagram.com/tryhirly",
  TIKTOK_URL: "https://tiktok.com/@tryhirly",
};

export const supportMailto = (subject = "") => {
  const base = `mailto:${BRAND.SUPPORT_EMAIL}`;
  if (!subject) return base;
  return `${base}?subject=${encodeURIComponent(subject)}`;
};
