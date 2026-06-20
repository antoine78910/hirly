/** French career hashtags — francophone / France market (training FR mode). */

/** Core set for France-focused career content. */
export const FR_CAREER_HASHTAGS = [
  "emploi",
  "job",
  "entretien",
  "alternance",
  "stage",
  "travail",
  "carriere",
  "cv",
  "rechercheemploi",
  "conseilscarriere",
  "jobsearch",
  "emploifrance",
  "tipsemploi",
];

export const FR_TRACKING_HASHTAG = "aihirlyai";

/** Build a hashtag line from tag names (without #). */
export function frHashtagLine(...tags) {
  const unique = [...new Set(tags.filter(Boolean))];
  return unique.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
}

/** Append caption body + hashtag line. */
export function frCaption(body, ...tags) {
  const line = frHashtagLine(...tags, FR_TRACKING_HASHTAG);
  const trimmed = body.trim();
  if (!line.includes("#aihirlyai") && tags.every((t) => t !== FR_TRACKING_HASHTAG)) {
    return `${trimmed}\n${frHashtagLine(...tags, FR_TRACKING_HASHTAG)}`;
  }
  return `${trimmed}\n${line}`;
}

/** Preset packs for warm-up posts & content bank. */
export const FR_HASHTAG_PACKS = {
  search: ["emploi", "rechercheemploi", "tipsemploi", "entretien", "emploifrance"],
  student: ["emploi", "alternance", "stage", "rechercheemploi", "conseilscarriere"],
  interview: ["entretien", "emploi", "tipsemploi", "conseilscarriere"],
  market: ["emploi", "tipsemploi", "entretien", "rechercheemploi", "travail"],
  platforms: ["rechercheemploi", "emploi", "tipsemploi", "cv", "emploifrance"],
  strategy: ["rechercheemploi", "tipsemploi", "conseilscarriere", "travail", "carriere"],
  offer: ["emploi", "rechercheemploi", "entretien", "travail", "carriere"],
  walk: ["entretien", "emploi", "rechercheemploi", "cv", "carriere"],
  linkedin: ["rechercheemploi", "tipsemploi", "emploi", "cv", "carriere"],
  apply: ["emploi", "rechercheemploi", "linkedin", "indeed", "conseilscarriere"],
  internship: ["stage", "alternance", "emploi", "rechercheemploi", "tipsemploi"],
  hired: ["rechercheemploi", "emploi", "travail", "carriere", "emploifrance"],
};

export function frPack(packName, includeTracking = true) {
  const tags = FR_HASHTAG_PACKS[packName] || FR_CAREER_HASHTAGS.slice(0, 5);
  return frHashtagLine(...tags, ...(includeTracking ? [FR_TRACKING_HASHTAG] : []));
}
