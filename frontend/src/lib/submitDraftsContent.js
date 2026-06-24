/** Submit drafts module — brief SOP (FR focus; EN kept minimal). */

export const TOPR_SUBMIT_URL =
  "https://topr.io/protected/campaign/27d12ae2-5f2b-45d7-9ec9-0a7451bcd570";

export const SUBMIT_DRAFTS_EN = [
  { type: "heading", level: 1, text: "Submit Drafts & Next Steps" },
  { type: "heading", level: 2, text: "Submission link" },
  {
    type: "callout",
    variant: "info",
    text: "When your video is ready, submit it on Topr using the link below.",
  },
  { type: "link", text: "Submit my video on Topr", href: TOPR_SUBMIT_URL },
  {
    type: "paragraph",
    text: "Follow the Content Bank script you used and include all required elements (hook, Hirly demo, caption).",
  },
  { type: "heading", level: 2, text: "Before you submit" },
  {
    type: "list",
    style: "bullet",
    items: [
      "Video matches the approved format from the Content Bank.",
      "Hirly is shown correctly on screen when required.",
      "Caption and hashtags match the script guidelines.",
      "Account followed warmup and posting SOPs.",
    ],
  },
  {
    type: "callout",
    variant: "info",
    text: "Review feedback is there to protect your account and payment eligibility — not to slow you down.",
  },
];

export const SUBMIT_DRAFTS_FR = [
  { type: "heading", level: 1, text: "Soumettre le contenu" },
  { type: "heading", level: 2, text: "Lien de soumission" },
  {
    type: "callout",
    variant: "info",
    text: "Quand ta vidéo est prête, soumets-la sur Topr via le lien ci-dessous.",
  },
  { type: "link", text: "Soumettre ma vidéo sur Topr", href: TOPR_SUBMIT_URL },
  {
    type: "paragraph",
    text: "Suis le script de la banque de contenu utilisé et inclus tous les éléments requis (accroche, démo Hirly, légende).",
  },
  { type: "heading", level: 2, text: "Avant de soumettre" },
  {
    type: "list",
    style: "bullet",
    items: [
      "La vidéo correspond au format approuvé de la banque de contenu.",
      "Hirly est bien montré à l'écran quand c'est requis.",
      "Légende et hashtags respectent les consignes du script.",
      "Le compte a suivi les SOP warmup et publication.",
    ],
  },
  {
    type: "callout",
    variant: "info",
    text: "Les retours de relecture protègent ton compte et ton éligibilité au paiement — ce n'est pas pour te ralentir.",
  },
];
