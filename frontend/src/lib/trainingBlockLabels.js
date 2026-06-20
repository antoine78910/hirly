/** Shared doc block labels for EN / FR training content. */

export const TRAINING_BLOCK_LABELS = {
  en: {
    examples: "Examples",
    guidelines: "Guidelines",
    mainScript: "Main Script",
    videoCaption: "Video Caption",
    videoCaptions: "Video Captions",
    caption: "Caption",
    captions: "Captions",
    variation: "Variation",
    linkToAudio: "Link to Audio",
    warmUpIntro:
      'Warm-Up Posts are creator-tested content formats from other Hirly creators that can help boost engagement and activity on your account. These posts are especially useful if you\'re just getting started in the program, or if you\'ve noticed your recent content is getting fewer views than usual and want to help "warm up" your account again.',
    warmUpPayoutNote:
      "Please note that Warm Up Posts receive 50% of the standard content payout. Must add #aihirlyai to the caption for tracking purposes.",
    captionExamples: "Caption Examples",
    videoTextHook: "Video Text Hook",
    outOfVideoCaption: "Out of Video Caption",
    refBadge: "Ref",
  },
  fr: {
    examples: "Exemples",
    guidelines: "Consignes",
    mainScript: "Script principal",
    videoCaption: "Légende vidéo",
    videoCaptions: "Légendes vidéo",
    caption: "Légende",
    captions: "Légendes",
    variation: "Variation",
    linkToAudio: "Lien vers l'audio",
    warmUpIntro:
      "Les Warm Up Posts sont des formats testés par d'autres créateurs Hirly pour booster l'engagement et l'activité sur ton compte. Ils sont surtout utiles si tu débutes dans le programme, ou si tes dernières vidéos ont moins de vues et que tu veux « réchauffer » ton compte.",
    warmUpPayoutNote:
      "Note : les Warm Up Posts sont payés à 50 % du tarif contenu standard. Ajoute #aihirlyai à la légende pour le suivi. Utilise des hashtags francophones (#emploi #rechercheemploi #tipsemploi #emploifrance…) — pas de hashtags US en mode FR.",
    captionExamples: "Exemples de légendes",
    videoTextHook: "Accroche texte dans la vidéo",
    outOfVideoCaption: "Légende hors vidéo",
    refBadge: "Réf",
  },
};

export function blockLabels(lang = "en") {
  return TRAINING_BLOCK_LABELS[lang] || TRAINING_BLOCK_LABELS.en;
}
