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
    columns: ["Tags", "Script"],
    rows: [
      [
        FR_TAGS.upload,
        [
          "Il suffit d'uploader ton CV",
          "Upload ton CV",
        ],
      ],
      [
        FR_TAGS.ai,
        [
          "Active la lettre et le CV IA",
          "Ils ont même une lettre et un CV IA pour chaque swipe",
          "Ils ADAPTENT ton CV et ta lettre de motivation",
        ],
      ],
      [
        FR_TAGS.swipe,
        [
          "Dès que tu swipes à droite, l'IA postule pour toi sur le site de l'entreprise",
          "Quand tu swipes à droite, ça postule sur le site pour toi",
        ],
      ],
      [
        FR_TAGS.history,
        [
          "Regarde, j'ai postulé à tout ça en 10 minutes",
          "Regarde, voici TOUTES mes candidatures passées",
          "Tu peux aussi suivre tes candidatures passées et leurs statuts",
        ],
      ],
    ],
  },
  ...HIRLY_EXAMPLE_VIDEOS_FR,
];

export const INTRODUCE_HIRLY_RESOURCES_EN = [
  { type: "heading", level: 4, text: "Main features + script" },
  {
    type: "table",
    columns: ["Tags", "Script"],
    rows: [
      [
        EN_TAGS.upload,
        [
          "All you gotta do is upload your resume",
          "Just upload your resume",
        ],
      ],
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
];
