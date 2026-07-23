/** Resource tables for Creating Content → Introducing Hirly (FR + EN). */

const tag = (text, color) => ({ type: "tag", text, color });

const FR_TAGS = {
  upload: tag("Importer ton CV", "yellow"),
  ai: tag("Lettre + CV IA", "blue"),
  swipe: tag("Fonction swipe", "pink"),
  history: tag("Onglet Historique", "purple"),
};

const EN_TAGS = {
  upload: tag("Upload your resume", "yellow"),
  ai: tag("AI cover letter/resume", "blue"),
  swipe: tag("Swiping feature", "pink"),
  history: tag("History tab", "purple"),
};

import { HIRLY_EXAMPLE_VIDEOS_FR } from "./hirlyExampleVideosFr";

export const INTRODUCE_HIRLY_RESOURCES_FR = [
  { type: "heading", level: 4, text: "Fonctionnalités principales + script" },
  {
    type: "table",
    columns: ["Fonctionnalités", "Script"],
    rows: [
      [
        FR_TAGS.upload,
        ["Tout ce que t'as à faire, c'est importer ton CV.", "Importe simplement ton CV."],
      ],
      [
        FR_TAGS.ai,
        [
          "Active la lettre de motivation et le CV générés par l'IA.",
          "L'IA génère même une lettre de motivation et un CV personnalisés pour chaque candidature.",
          "Elle adapte automatiquement ton CV et ta lettre de motivation à chaque offre.",
        ],
      ],
      [
        FR_TAGS.swipe,
        [
          "À chaque fois que tu swipes à droite, l'IA postule automatiquement pour toi sur le site de l'entreprise.",
          "Tu swipes à droite, et la candidature est envoyée automatiquement.",
        ],
      ],
      [
        FR_TAGS.history,
        [
          "Regarde, j'ai postulé à toutes ces offres en seulement 10 minutes.",
          "Là, tu peux voir toutes mes candidatures précédentes.",
          "Tu peux aussi suivre l'avancement et le statut de chacune de tes candidatures.",
        ],
      ],
    ],
  },
  { type: "heading", level: 4, text: "Façons de présenter Hirly" },
  {
    type: "table",
    columns: ["", "Variation 1", "Variation 2", "Variation 3"],
    rows: [
      [{ type: "label", text: "Court" }, [FR_TAGS.upload, FR_TAGS.swipe], [], []],
      [
        { type: "label", text: "Moyen" },
        [FR_TAGS.upload, FR_TAGS.ai, FR_TAGS.swipe],
        [FR_TAGS.upload, FR_TAGS.swipe, FR_TAGS.history],
        [FR_TAGS.upload, FR_TAGS.swipe, FR_TAGS.ai],
      ],
      [
        { type: "label", text: "Long" },
        [FR_TAGS.upload, FR_TAGS.ai, FR_TAGS.swipe, FR_TAGS.history],
        [FR_TAGS.upload, FR_TAGS.swipe, FR_TAGS.ai, FR_TAGS.history],
        [],
      ],
    ],
  },
  ...HIRLY_EXAMPLE_VIDEOS_FR,
];

export const INTRODUCE_HIRLY_RESOURCES_EN = [
  { type: "heading", level: 4, text: "Main features + script" },
  {
    type: "table",
    columns: ["Fonctionnalités", "Script"],
    rows: [
      [EN_TAGS.upload, ["All you gotta do is upload your resume", "Just upload your resume"]],
      [
        EN_TAGS.ai,
        [
          "Turn on the AI cover letter and resume",
          "They even have AI cover letter and resume for EACH swipe",
          "They TAILOR your resume and cover letter",
        ],
      ],
      [
        EN_TAGS.swipe,
        [
          "Whenever you swipe right, the AI just automatically applies for you on the company website",
          "When you swipe right it just applies on the website for you",
        ],
      ],
      [
        EN_TAGS.history,
        [
          "Look I applied to all of these in 10 minutes",
          "Look these are ALL my past applications",
          "You can also track all your past applications and statuses",
        ],
      ],
    ],
  },
  { type: "heading", level: 4, text: "Ways to introduce Hirly" },
  {
    type: "table",
    columns: ["", "Variation 1", "Variation 2", "Variation 3"],
    rows: [
      [{ type: "label", text: "Short" }, [EN_TAGS.upload, EN_TAGS.swipe], [], []],
      [
        { type: "label", text: "Medium" },
        [EN_TAGS.upload, EN_TAGS.ai, EN_TAGS.swipe],
        [EN_TAGS.upload, EN_TAGS.swipe, EN_TAGS.history],
        [EN_TAGS.upload, EN_TAGS.swipe, EN_TAGS.ai],
      ],
      [
        { type: "label", text: "Long" },
        [EN_TAGS.upload, EN_TAGS.ai, EN_TAGS.swipe, EN_TAGS.history],
        [EN_TAGS.upload, EN_TAGS.swipe, EN_TAGS.ai, EN_TAGS.history],
        [],
      ],
    ],
  },
  ...HIRLY_EXAMPLE_VIDEOS_FR,
];
