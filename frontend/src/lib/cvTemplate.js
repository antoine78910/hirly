/** Professional CV layout constants and helpers. */

export const PROFESSIONAL_CV_TEMPLATE = "professional";

export const PRO_CV_PAGE = {
  widthPt: 595.28,
  heightPt: 841.89,
};

/** Muted palette — no bright colors. */
export const PRO_CV_COLORS_PHOTO = {
  accent: "#5C6B7A",
  text: "#1F2937",
  muted: "#6B7280",
  line: "#D1D5DB",
  photoRing: "#FFFFFF",
};

export const PRO_CV_COLORS_PLAIN = {
  accent: "#374151",
  text: "#111827",
  muted: "#6B7280",
  line: "#E5E7EB",
};

/** @deprecated use resolveProfessionalVariant */
export const PRO_CV_COLORS = PRO_CV_COLORS_PHOTO;

export const HIRLY_DEFAULT_CV_TEMPLATE = "hirly_default";

// Hard-locked to the single Hirly-branded template for every user (see the
// "New default Hirly CV template" plan) -- ignores whatever template was
// requested. PROFESSIONAL_CV_TEMPLATE is kept only because
// ProfessionalCVPreview etc. still exist unused, in case per-user template
// variety returns later.
export function resolveCvDisplayTemplate() {
  return HIRLY_DEFAULT_CV_TEMPLATE;
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
  const parts = String(name || "CV")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "CV";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function getContactPhotoUrl(contact = {}) {
  return contact.picture || contact.photoUrl || contact.photo || contact.avatar || null;
}

export function hasContactPhoto(contact = {}) {
  return Boolean(getContactPhotoUrl(contact));
}

export function withContactPhoto(contact = {}, picture) {
  if (!picture || getContactPhotoUrl(contact)) return contact;
  return { ...contact, picture };
}

/** The Hirly CV template shows the photo extracted from the user's own
 * uploaded CV, never their Google/LinkedIn login avatar -- no CV photo means
 * no photo at all, by design. */
export function cvPhotoDataUrl(profile) {
  if (!profile?.cv_photo_b64) return null;
  return `data:${profile.cv_photo_mime || "image/jpeg"};base64,${profile.cv_photo_b64}`;
}

/** Photo collar template when a profile image exists; otherwise plain two-column. */
export function resolveProfessionalVariant(contact = {}) {
  return hasContactPhoto(contact) ? "photo" : "plain";
}

export function socialLinksFromContact(contact = {}) {
  const links = [];
  if (contact.linkedin) links.push({ label: "LinkedIn", value: contact.linkedin });
  if (contact.website) links.push({ label: "Website", value: contact.website });
  if (contact.github) links.push({ label: "GitHub", value: contact.github });
  return links;
}

export function estimateProfessionalContentHeight(
  { contact = {}, resume = {} },
  { contentStartPt } = {},
) {
  const socialLinks = socialLinksFromContact(contact);
  const contactBlocks = [contact.location, contact.phone, contact.email].filter(Boolean).length;
  let height = 0;

  height += 28;
  height += contactBlocks * 34;
  if (socialLinks.length) height += 28 + socialLinks.length * 18;
  if (resume.skills?.length) height += 28 + resume.skills.length * 17;
  if (resume.languages?.length) height += 28 + resume.languages.length * 16;

  if (resume.summary) {
    height += 28 + Math.ceil(String(resume.summary).length / 85) * 15;
  }
  if (resume.education?.length) {
    height += 28 + resume.education.length * 38;
  }
  if (resume.experience?.length) {
    height += 28;
    resume.experience.forEach((entry) => {
      height += 38;
      height += (entry.highlights?.length || 0) * 16;
    });
  }
  if (resume.highlights?.length) {
    height += 28 + resume.highlights.length * 16;
  }

  if (contentStartPt) {
    height += contentStartPt;
  }

  return height;
}

export function computeVerticalFillScale(
  contentHeight,
  {
    contentStart = PRO_CV_LAYOUT_PHOTO.contentStartPt,
    pageHeight = PRO_CV_PAGE.heightPt,
    bottomMargin = 36,
  } = {},
) {
  const available = pageHeight - contentStart - bottomMargin;
  if (!contentHeight || contentHeight >= available) return 1;
  return Math.min(1.35, Math.max(1, available / contentHeight));
}

/** Centered collar for photo variant (viewBox 794 × 120). */
export const PRO_CV_HEADER_VIEWBOX = "0 0 794 120";
export const PRO_CV_HEADER_PATH = [
  "M262,0 H532 V16",
  "C532,16 498,96 397,96",
  "C296,96 262,16 262,16 Z",
].join(" ");

export const PRO_CV_LAYOUT_PHOTO = {
  marginX: 48,
  leftColWidth: 164,
  columnGap: 20,
  headerHeightPt: 96,
  nameRowY: 128,
  contentStartPt: 188,
  photoRadiusPt: 30,
  /** Center of collar dip on page (page midpoint). */
  photoCenterY: 58,
};

export const PRO_CV_LAYOUT_PLAIN = {
  marginX: 48,
  leftColWidth: 164,
  columnGap: 20,
  contentStartPt: 118,
};

export function getColumnPositions(pageWidth = PRO_CV_PAGE.widthPt, layout = PRO_CV_LAYOUT_PHOTO) {
  const leftX = layout.marginX;
  const leftW = layout.leftColWidth;
  const rightX = leftX + leftW + layout.columnGap;
  const rightW = pageWidth - rightX - layout.marginX;
  const dividerX = leftX + leftW + layout.columnGap / 2;
  return { leftX, leftW, rightX, rightW, dividerX };
}
