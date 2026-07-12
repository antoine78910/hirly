/** Shared CV template resolution and layout tokens (professional two-column style). */

export const PROFESSIONAL_CV_TEMPLATE = "professional";

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

export const PRO_CV_COLORS = {
  accent: "#16467A",
  accentLight: "#1F5C99",
  text: "#1A1A1A",
  muted: "#6B7280",
  line: "#D1D5DB",
  sidebarBg: "#FFFFFF",
  photoBg: "#E5E7EB",
};

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

export function socialLinksFromContact(contact = {}) {
  const links = [];
  if (contact.linkedin) links.push({ label: "LinkedIn", value: contact.linkedin });
  if (contact.website) links.push({ label: "Website", value: contact.website });
  if (contact.github) links.push({ label: "GitHub", value: contact.github });
  return links;
}
