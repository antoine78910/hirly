/** Professional CV layout constants and helpers (reference template). */

export const PROFESSIONAL_CV_TEMPLATE = "professional";

export const PRO_CV_PAGE = {
  widthPt: 595.28,
  heightPt: 841.89,
};

export const PRO_CV_COLORS = {
  accent: "#1B4F8A",
  accentDark: "#16467A",
  text: "#111111",
  muted: "#6B7280",
  line: "#D1D5DB",
  photoBg: "#D1D5DB",
  photoRing: "#FFFFFF",
};

const LEGACY_PROFESSIONAL_ALIASES = new Set([
  "modern",
  "two_column",
  "blue_split",
  "modern_pro",
  "ats_classic",
  "executive_compact",
  "luxe_minimal",
  "studio_slate",
]);

export function resolveCvDisplayTemplate(template) {
  const value = (template || "").trim().toLowerCase();
  if (value === "classic" || value === "minimal") return value;
  if (value === PROFESSIONAL_CV_TEMPLATE || LEGACY_PROFESSIONAL_ALIASES.has(value)) {
    return PROFESSIONAL_CV_TEMPLATE;
  }
  return PROFESSIONAL_CV_TEMPLATE;
}

export function parseLanguageEntry(entry) {
  const raw = String(entry || "").trim();
  if (!raw) return { name: "", level: "" };
  const dashSplit = raw.split(/\s[-–—]\s/);
  if (dashSplit.length >= 2) {
    return { name: dashSplit[0].trim(), level: dashSplit.slice(1).join(" - ").trim() };
  }
  const colonSplit = raw.split(":");
  if (colonSplit.length >= 2) {
    return { name: colonSplit[0].trim(), level: colonSplit.slice(1).join(":").trim() };
  }
  return { name: raw, level: "" };
}

export function contactInitials(name) {
  const parts = String(name || "CV").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CV";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

export function getContactPhotoUrl(contact = {}) {
  return contact.picture || contact.photoUrl || contact.photo || contact.avatar || null;
}

export function withContactPhoto(contact = {}, picture) {
  if (!picture || getContactPhotoUrl(contact)) return contact;
  return { ...contact, picture };
}

export function socialLinksFromContact(contact = {}) {
  const links = [];
  if (contact.linkedin) links.push({ label: "LinkedIn", value: contact.linkedin });
  if (contact.website) links.push({ label: "Website", value: contact.website });
  if (contact.github) links.push({ label: "GitHub", value: contact.github });
  return links;
}

export function estimateProfessionalContentHeight({ contact = {}, resume = {} }) {
  const socialLinks = socialLinksFromContact(contact);
  const contactBlocks = [contact.location, contact.phone, contact.email].filter(Boolean).length;
  let height = 0;

  height += 22; // section header
  height += contactBlocks * 30;
  if (socialLinks.length) height += 22 + socialLinks.length * 16;
  if (resume.skills?.length) height += 22 + resume.skills.length * 15;
  if (resume.languages?.length) height += 22 + resume.languages.length * 14;

  if (resume.summary) {
    const chars = String(resume.summary).length;
    height += 22 + Math.ceil(chars / 90) * 14;
  }
  if (resume.education?.length) {
    height += 22 + resume.education.length * 36;
  }
  if (resume.experience?.length) {
    height += 22;
    resume.experience.forEach((entry) => {
      height += 34;
      height += (entry.highlights?.length || 0) * 15;
    });
  }
  if (resume.highlights?.length) {
    height += 22 + resume.highlights.length * 15;
  }

  return height;
}

/** Scale vertical spacing so short CVs still fill one A4 page. */
export function computeVerticalFillScale(contentHeight, {
  contentStart = 150,
  pageHeight = PRO_CV_PAGE.heightPt,
  bottomMargin = 28,
} = {}) {
  const available = pageHeight - contentStart - bottomMargin;
  if (!contentHeight || contentHeight >= available) return 1;
  return Math.min(2.35, Math.max(1.12, available / contentHeight));
}

/** SVG path for the blue collar header (viewBox 794 x 130). */
export const PRO_CV_HEADER_PATH = [
  "M0,0 H794 V24 H548",
  "C680,24 620,108 397,108",
  "C174,108 114,24 246,24 H0 Z",
].join(" ");

export const PRO_CV_LAYOUT = {
  marginX: 44,
  leftColWidth: 168,
  columnGap: 18,
  headerHeightPx: 130,
  contentStartPt: 138,
  photoRadiusPt: 34,
  photoCenterY: 80,
};

export function getColumnPositions(pageWidth = PRO_CV_PAGE.widthPt) {
  const leftX = PRO_CV_LAYOUT.marginX;
  const leftW = PRO_CV_LAYOUT.leftColWidth;
  const rightX = leftX + leftW + PRO_CV_LAYOUT.columnGap;
  const rightW = pageWidth - rightX - PRO_CV_LAYOUT.marginX;
  const dividerX = leftX + leftW + PRO_CV_LAYOUT.columnGap / 2;
  return { leftX, leftW, rightX, rightW, dividerX };
}
