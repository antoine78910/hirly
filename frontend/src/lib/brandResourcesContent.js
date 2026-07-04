/** Brand assets (logos, etc.) for the training "Resources" module (FR + EN). */

const BRAND_ASSETS_DRIVE_URL =
  "https://drive.google.com/drive/folders/1_6Q7rK8LbzAHu4CUqpx6R0HkIhfrZZ4b?usp=sharing";

export const BRAND_RESOURCES_FR = [
  { type: "heading", level: 2, text: "Logos & ressources de marque" },
  {
    type: "paragraph",
    text: "Retrouve ici les logos officiels Hirly à utiliser dans tes vidéos, miniatures et visuels. Utilise toujours ces fichiers plutôt qu'une capture d'écran ou un logo recréé toi-même.",
  },
  { type: "link", text: "Ouvrir le dossier Google Drive (logos Hirly)", href: BRAND_ASSETS_DRIVE_URL },
  { type: "heading", level: 4, text: "Bonnes pratiques" },
  {
    type: "list",
    items: [
      "Utilise le logo sur fond transparent (PNG) pour les incrustations vidéo",
      "Ne déforme pas, ne recolore pas et n'ajoute pas d'effet au logo",
      "Garde un espace de respiration autour du logo, ne le colle pas aux bords",
      "En cas de doute sur un usage, demande à l'équipe Hirly avant de publier",
    ],
  },
  {
    type: "callout",
    variant: "info",
    text: "Ce dossier sera enrichi au fil du temps (bannières, couleurs de marque, polices...). Reviens y de temps en temps.",
  },
];

export const BRAND_RESOURCES_EN = [
  { type: "heading", level: 2, text: "Logos & brand assets" },
  {
    type: "paragraph",
    text: "Find the official Hirly logos here to use in your videos, thumbnails, and visuals. Always use these files instead of a screenshot or a logo you recreated yourself.",
  },
  { type: "link", text: "Open the Google Drive folder (Hirly logos)", href: BRAND_ASSETS_DRIVE_URL },
  { type: "heading", level: 4, text: "Best practices" },
  {
    type: "list",
    items: [
      "Use the transparent-background logo (PNG) for video overlays",
      "Don't stretch, recolor, or add effects to the logo",
      "Keep breathing room around the logo — don't crop it against the edges",
      "Not sure about a specific use? Ask the Hirly team before publishing",
    ],
  },
  {
    type: "callout",
    variant: "info",
    text: "This folder will grow over time (banners, brand colors, fonts...). Check back from time to time.",
  },
];
