/** Localized example videos for Introducing Hirly, backed by Content Bank slots. */

const TRAINING_VIDEO_ROOT = "/training-videos";

const EXAMPLE_COPY = {
  en: {
    heading: "Video examples",
    intro: "Open each topic to see the examples. Where a short and long version exist, both are listed.",
    swipeTitle: "Swipe",
    swipeDescription: "Show the right swipe — it is the core feature to highlight early in the video.",
    historyTitle: "Application history",
    historyDescription: "Show the volume of applications and how they are tracked — ideal for a hook or the end of the video.",
    shortHeading: "Short version",
    shortLabel: "Short",
    longHeading: "Long version",
    longLabel: "Long",
    resumeTitle: "Resume & AI cover letter",
    resumeDescription: "Show that Hirly tailors the resume and generates a cover letter for every job.",
    resumeShortHeading: "Resume — short version",
    resumeShortLabel: "Resume — short",
    resumeLongHeading: "Resume — long version",
    resumeLongLabel: "Resume — long",
    coverLetterHeading: "AI cover letter",
    coverLetterLabel: "AI cover letter",
    filmingTitle: "Filming formats",
    filmingDescription: "Examples based on how you film the on-screen demo.",
    greenScreenHeading: "Green screen — without a phone or computer",
    greenScreenLabel: "Green screen",
    greenScreenTutorial: "Green-screen tutorial (TikTok)",
    laptopHeading: "With a laptop",
    laptopLabel: "Laptop",
    laptopSilentHeading: "Laptop — without speaking",
    laptopSilentLabel: "Laptop without speaking",
    tabletHeading: "With a phone or tablet",
    tabletLabel: "Phone or tablet",
  },
  fr: {
    heading: "Exemples vidéo",
    intro: "Ouvre chaque thème pour voir les exemples. Quand il existe une version courte et une version longue, les deux sont listées.",
    swipeTitle: "Swipe",
    swipeDescription: "Montre le swipe à droite — c’est la fonctionnalité centrale à mettre en avant tôt dans la vidéo.",
    historyTitle: "Historique",
    historyDescription: "Prouve le volume et le suivi des candidatures — idéal en hook ou en fin de vidéo.",
    shortHeading: "Version courte",
    shortLabel: "court",
    longHeading: "Version longue",
    longLabel: "long",
    resumeTitle: "CV & lettre IA",
    resumeDescription: "Montre que Hirly adapte le CV et génère la lettre pour chaque offre.",
    resumeShortHeading: "CV — version courte",
    resumeShortLabel: "CV — court",
    resumeLongHeading: "CV — version longue",
    resumeLongLabel: "CV — long",
    coverLetterHeading: "Lettre de motivation IA",
    coverLetterLabel: "Lettre IA",
    filmingTitle: "Formats de tournage",
    filmingDescription: "Exemples selon comment tu filmes la démo à l’écran.",
    greenScreenHeading: "Green screen — sans téléphone ni ordinateur",
    greenScreenLabel: "Green screen",
    greenScreenTutorial: "Tuto green screen (TikTok)",
    laptopHeading: "Avec ordinateur portable",
    laptopLabel: "Ordinateur portable",
    laptopSilentHeading: "Ordinateur portable — sans parole",
    laptopSilentLabel: "Laptop sans parole",
    tabletHeading: "Avec téléphone ou tablette",
    tabletLabel: "Téléphone ou tablette",
  },
};

export function contentBankExampleVideoUrl(sectionId) {
  return `${TRAINING_VIDEO_ROOT}/course_job_search_mastery/mod_content_bank/${sectionId}/fr.mp4`;
}

function exampleVideo(sectionId, uploadLabel) {
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

export function createHirlyExampleVideos(locale) {
  const copy = EXAMPLE_COPY[locale];
  return [
    { type: "heading", level: 4, text: copy.heading },
    { type: "callout", variant: "info", text: copy.intro },
    {
      type: "accordion",
      items: [
        {
          title: copy.swipeTitle,
          content: [
            { type: "paragraph", text: copy.swipeDescription },
            exampleVideo("sec_cb_swiping", copy.swipeTitle),
          ],
        },
        {
          title: copy.historyTitle,
          content: [
            { type: "paragraph", text: copy.historyDescription },
            subheading(copy.shortHeading),
            exampleVideo("sec_cb_history_short", `${copy.historyTitle} — ${copy.shortLabel}`),
            subheading(copy.longHeading),
            exampleVideo("sec_cb_history_long", `${copy.historyTitle} — ${copy.longLabel}`),
          ],
        },
        {
          title: copy.resumeTitle,
          content: [
            { type: "paragraph", text: copy.resumeDescription },
            subheading(copy.resumeShortHeading),
            exampleVideo("sec_cb_cv_short", copy.resumeShortLabel),
            subheading(copy.resumeLongHeading),
            exampleVideo("sec_cb_cv_long", copy.resumeLongLabel),
            subheading(copy.coverLetterHeading),
            exampleVideo("sec_cb_cover_letter_ai", copy.coverLetterLabel),
          ],
        },
        {
          title: copy.filmingTitle,
          content: [
            { type: "paragraph", text: copy.filmingDescription },
            subheading(copy.greenScreenHeading),
            exampleVideo("sec_cb_green_screen", copy.greenScreenLabel),
            {
              type: "link",
              text: copy.greenScreenTutorial,
              href: `https://www.tiktok.com/@thesocialcreativesclub/video/7338507673932942625?lang=${locale}`,
            },
            subheading(copy.laptopHeading),
            exampleVideo("sec_cb_laptop_example", copy.laptopLabel),
            subheading(copy.laptopSilentHeading),
            exampleVideo("sec_cb_laptop_without_talking", copy.laptopSilentLabel),
            subheading(copy.tabletHeading),
            exampleVideo("sec_cb_tablet_example", copy.tabletLabel),
          ],
        },
      ],
    },
  ];
}

export const HIRLY_EXAMPLE_VIDEOS_EN = createHirlyExampleVideos("en");
export const HIRLY_EXAMPLE_VIDEOS_FR = createHirlyExampleVideos("fr");
