/** Posting schedule blocks for training warm-up / filming (locale-specific). */

export function postingHoursBlocks(lang = "en") {
  if (lang === "fr") {
    return [
      {
        type: "heading",
        level: 2,
        text: "Meilleurs horaires de publication (France — CET/CEST)",
      },
      { type: "paragraph", text: "Poste uniquement pendant :" },
      {
        type: "list",
        style: "bullet",
        items: ["7h–9h (heure de Paris)", "12h–14h", "19h–22h"],
      },
      {
        type: "paragraph",
        text: "Évite de poster la nuit ou en simulant le fuseau US (ET/PT). Cible ton audience en France et en francophonie — pas les États-Unis.",
      },
    ];
  }

  return [
    { type: "heading", level: 2, text: "Best Posting (US)" },
    { type: "paragraph", text: "Post only during:" },
    {
      type: "list",
      style: "bullet",
      items: ["7–9 AM ET", "11 AM–1 PM ET", "6–9 PM ET"],
    },
    {
      type: "paragraph",
      text: "Avoid posting during US sleeping hours or random timezone posting.",
    },
  ];
}

export const FR_POSTING_HOURS_SUMMARY = "7h–9h, 12h–14h et 19h–22h (heure de Paris — CET/CEST)";
