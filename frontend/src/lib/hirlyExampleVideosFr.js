/** Example videos for Présenter Hirly (FR) — accordion by theme, Content Bank slots. */

const TRAINING_VIDEO_ROOT = "/training-videos";

export function contentBankExampleVideoUrl(sectionId) {
  return `${TRAINING_VIDEO_ROOT}/course_job_search_mastery/mod_content_bank/${sectionId}/fr.mp4`;
}

function exampleVideo(sectionId, uploadLabel = "") {
  return {
    type: "short_video",
    video_url: contentBankExampleVideoUrl(sectionId),
    upload_label: uploadLabel,
    aspect: "9:16",
    upload_slot: sectionId,
  };
}

function subheading(text) {
  return { type: "heading", level: 4, text };
}

function shortVersion(label = "Version courte") {
  return subheading(label);
}

function longVersion(label = "Version longue") {
  return subheading(label);
}

export const HIRLY_EXAMPLE_VIDEOS_FR = [
  { type: "heading", level: 4, text: "Exemples vidéo" },
  {
    type: "callout",
    variant: "info",
    text: "Ouvre chaque thème pour voir les exemples. Quand il existe une version courte et une version longue, les deux sont listées.",
  },
  {
    type: "accordion",
    items: [
      {
        title: "Swipe",
        content: [
          {
            type: "paragraph",
            text: "Montre le swipe à droite — c’est la fonctionnalité centrale à mettre en avant tôt dans la vidéo.",
          },
          exampleVideo("sec_cb_swiping", "Swipe"),
        ],
      },
      {
        title: "Historique",
        content: [
          {
            type: "paragraph",
            text: "Prouve le volume et le suivi des candidatures — idéal en hook ou en fin de vidéo.",
          },
          shortVersion(),
          exampleVideo("sec_cb_history_short", "Historique — court"),
          longVersion(),
          exampleVideo("sec_cb_history_long", "Historique — long"),
        ],
      },
      {
        title: "CV & lettre IA",
        content: [
          {
            type: "paragraph",
            text: "Montre que Hirly adapte le CV et génère la lettre pour chaque offre.",
          },
          shortVersion("CV — version courte"),
          exampleVideo("sec_cb_cv_short", "CV — court"),
          longVersion("CV — version longue"),
          exampleVideo("sec_cb_cv_long", "CV — long"),
          subheading("Lettre de motivation IA"),
          exampleVideo("sec_cb_cover_letter_ai", "Lettre IA"),
        ],
      },
      {
        title: "Formats de tournage",
        content: [
          {
            type: "paragraph",
            text: "Exemples selon comment tu filmes la démo à l’écran.",
          },
          subheading("Green screen — without phone or laptop"),
          exampleVideo("sec_cb_green_screen", "Green screen"),
          subheading("With laptop"),
          exampleVideo("sec_cb_laptop_example", "Laptop"),
          subheading("With phone or tablet"),
          exampleVideo("sec_cb_tablet_example", "Phone or tablet"),
        ],
      },
    ],
  },
];
