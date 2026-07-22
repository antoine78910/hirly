/** Creating Content sub-chapters (mirrors backend training_module_content.py). */

import { postingHoursBlocks } from "./trainingPostingHours";
import { INTRODUCE_HIRLY_RESOURCES_EN, INTRODUCE_HIRLY_RESOURCES_FR } from "./introIntroResources";

/** Presentation video — Creating Content §1 (Filming / Guide de tournage). */
export const CREATING_CONTENT_FILMING_VIDEO_URL =
  "https://player.mediadelivery.net/play/689678/4f0053f4-a610-4fd4-80d0-53ac9f320dfe";

/** Presentation video — Creating Content §3 (Editing / Guide de montage). */
export const CREATING_CONTENT_EDITING_VIDEO_URL =
  "https://player.mediadelivery.net/play/689678/f53914da-75ae-470e-83c2-fee9896774b0";

export const CREATING_CONTENT_SECTIONS_EN = [
  {
    section_id: "sec_cc_filming",
    title: "Filming Playbook",
    video_url: CREATING_CONTENT_FILMING_VIDEO_URL,
    content: [
      { type: "paragraph", text: "Make sure:" },
      { type: "heading", level: 3, text: "1. Hook (First 3 Seconds Matter Most)" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Get straight to the point immediately — no slow buildup.",
          "Use emotion or action to grab attention.",
        ],
      },
      { type: "paragraph", text: "Good hooks often include:" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Passionate talking, dramatic expressions, complaining or ranting",
          "Doing something else on the side like eating snacks or cutting fruit while talking (creates action)",
        ],
      },
      { type: "paragraph", text: "The goal is to stop the scroll instantly." },
      { type: "heading", level: 3, text: "2. Tone & Delivery" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Sound natural, casual, and be slightly funnier + more expressive than your normal self.",
          "Talk like you're FaceTiming a friend and sharing gossip or tea.",
          "If it sounds rehearsed or like you're reading a script, redo the take.",
        ],
      },
      { type: "heading", level: 3, text: "3. Facial Expressions" },
      { type: "paragraph", text: "Your face sells the video, so exaggeration helps." },
      {
        type: "paragraph",
        text: "Use: eyebrow raises, smirks, eye rolls, awkward reactions, dramatic expressions.",
      },
      { type: "paragraph", text: "These create visual engagement even without sound." },
      { type: "heading", level: 3, text: "4. Pacing" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Speak slightly faster than normal conversation speed.",
          "Avoid long pauses.",
          "Only pause for punchlines or comedic timing.",
          "If pacing is slow, viewers will scroll away quickly.",
        ],
      },
      { type: "heading", level: 3, text: "5. Video Length" },
      { type: "paragraph", text: "Recommended length:" },
      {
        type: "list",
        style: "bullet",
        items: ["7–45 seconds total", "Under 30 seconds for new creators or new accounts"],
      },
      { type: "paragraph", text: "Shorter videos perform better for growth and retention." },
      { type: "heading", level: 3, text: "6. Framing & Camera Shots" },
      { type: "paragraph", text: "Avoid the death zone. Use the safe center zone for your face:" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Top of the screen",
          "Bottom of the screen",
          "Areas where captions and UI overlays appear",
        ],
      },
      { type: "paragraph", text: "Use multiple angles to maintain engagement:" },
      {
        type: "list",
        style: "bullet",
        items: ["Long shot", "Medium shot", "Close-up shot"],
      },
      { type: "paragraph", text: "Switch shots every few seconds to make the video feel faster." },
    ],
  },
  {
    section_id: "sec_cc_hirly",
    title: "Introducing Hirly in Videos",
    video_url: "",
    content: [
      { type: "heading", level: 2, text: "Showing the Product (Hirly)" },
      {
        type: "paragraph",
        text: "When demonstrating Hirly, always highlight the swiping feature first because it's the core functionality.",
      },
      { type: "paragraph", text: "Important features to mention:" },
      {
        type: "list",
        style: "numbered",
        items: [
          "Upload resume",
          "Swipe right to auto-apply",
          "AI resume / cover letter",
          "Application history tab",
        ],
      },
      { type: "paragraph", text: "Best flow:" },
      {
        type: "list",
        style: "numbered",
        items: [
          "Upload resume",
          "Swipe to apply",
          "Mention AI resume/cover letter",
          "Show application history",
        ],
      },
      { type: "paragraph", text: "This makes the process clear and easy to understand." },
      { type: "heading", level: 3, text: "Filming Product Demonstrations" },
      { type: "paragraph", text: "Best ways to show the app:" },
      {
        type: "list",
        style: "numbered",
        items: [
          "POV Tutorial (Best) — film the phone/laptop from another device and walk through the steps live",
          "Screen Recording — use green screen and explain the steps",
          "Text Tutorial — use trendy audio and add text explaining steps on screen",
        ],
      },
      { type: "paragraph", text: "Tips:" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Show big recognizable companies when swiping (Meta, Google, etc.)",
          "This increases relatability and credibility",
        ],
      },
    ],
    resources: INTRODUCE_HIRLY_RESOURCES_EN,
  },
  {
    section_id: "sec_cc_editing",
    title: "Editing Playbook",
    video_url: CREATING_CONTENT_EDITING_VIDEO_URL,
    content: [
      { type: "paragraph", text: "Edit in CapCut (mobile or desktop). Follow this order:" },
      { type: "heading", level: 3, text: "1. Import & Trim" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Import all clips from filming — keep every angle you shot.",
          'Split and delete long pauses, "ums," mistakes, and dead air.',
          "Keep only the high-energy takes. Tighter trims feel more professional instantly.",
        ],
      },
      { type: "heading", level: 3, text: "2. Jump Cuts & Pacing" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Use jump cuts wherever energy dips or you removed a section.",
          "Cut every 1.5–3 seconds on Shorts — fast pacing keeps viewers watching.",
          "Only keep pauses for punchlines or comedic timing.",
        ],
      },
      { type: "heading", level: 3, text: "3. Cut Between Angles" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Alternate between long, medium, and close-up shots every few seconds.",
          "Match your eye line between clips so cuts feel smooth, not jarring.",
          "Add a light 10–20% zoom in or out between clips if you only have one angle.",
        ],
      },
      { type: "heading", level: 3, text: "4. Speed Adjustments" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Slow B-roll or action clips to 0.5–1× when the format calls for it.",
          "Do not speed up talking-head dialogue — it sounds unnatural.",
          "Use speed changes on visual clips only, not your main voiceover.",
        ],
      },
      { type: "heading", level: 3, text: "5. Audio & Trending Sound" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Add trending audio at low volume under your voice when the format uses music.",
          "Keep your voice clear and louder than the background track.",
          "Sync cuts to the beat on music-driven formats (Good/Better/Best, trending songs, etc.).",
        ],
      },
      { type: "heading", level: 3, text: "6. On-Screen Text & Hooks" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Add a text hook in the first 1–2 seconds if the verbal hook needs reinforcement.",
          'Pop up key phrases as you speak — especially for product demos (include "Hirly" on screen).',
          "Keep text inside safe zones — avoid the top and bottom UI overlay areas.",
        ],
      },
      { type: "heading", level: 3, text: "7. In-Video Captions" },
      { type: "paragraph", text: "Important because ~50% of viewers watch without sound." },
      { type: "paragraph", text: "Best practices:" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Use auto captions with the font named Custom/Standard",
          "Keep captions to 1–2 lines max — avoid huge 3–4 text blocks",
          "Place captions centered, not on edges",
        ],
      },
      ...postingHoursBlocks("en"),
    ],
  },
];

export const CREATING_CONTENT_SECTIONS_FR = [
  {
    section_id: "sec_cc_filming",
    title: "Guide de tournage",
    video_url: CREATING_CONTENT_FILMING_VIDEO_URL,
    content: [
      { type: "paragraph", text: "Assure-toi de :" },
      { type: "heading", level: 3, text: "1. Hook (les 3 premières secondes comptent le plus)" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Va droit au but immédiatement — pas de montée en puissance lente.",
          "Utilise l'émotion ou l'action pour capter l'attention.",
        ],
      },
      { type: "paragraph", text: "Les bons hooks incluent souvent :" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Parler avec passion, expressions dramatiques, se plaindre ou râler",
          "Faire autre chose sur le côté (manger, couper des fruits) en parlant — ça crée de l'action",
        ],
      },
      { type: "paragraph", text: "L'objectif : stopper le scroll instantanément." },
      { type: "heading", level: 3, text: "2. Ton & diction" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Sois naturel, décontracté, un peu plus drôle et expressif qu'à l'habitude.",
          "Parle comme si tu discutais avec un ami en lui partageant un secret.",
          "Si ça sonne récité ou comme si tu lisais un script, refais la prise.",
        ],
      },
      { type: "heading", level: 3, text: "3. Expressions faciales" },
      { type: "paragraph", text: "Ton visage vend la vidéo — l'exagération aide." },
      {
        type: "paragraph",
        text: "Utilise : sourcils levés, sourires en coin, roulements des yeux, réactions décalées, expressions dramatiques.",
      },
      { type: "paragraph", text: "Ça crée de l'engagement visuel même sans le son." },
      { type: "heading", level: 3, text: "4. Rythme" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Parle un peu plus vite que dans une conversation normale.",
          "Évite les longues pauses.",
          "Pause seulement pour les punchlines ou le timing comique.",
          "Si le rythme est lent, les gens décrochent rapidement.",
        ],
      },
      { type: "heading", level: 3, text: "5. Durée de la vidéo" },
      { type: "paragraph", text: "Durée recommandée :" },
      {
        type: "list",
        style: "bullet",
        items: [
          "7–45 secondes au total",
          "Pas plus de 30 secondes pour les débutants ou comptes récents",
        ],
      },
      {
        type: "paragraph",
        text: "Les vidéos courtes performent mieux pour la croissance et la rétention.",
      },
      { type: "heading", level: 3, text: "6. Cadrage & plans caméra" },
      {
        type: "paragraph",
        text: "Évite la zone morte. Utilise la zone centrale safe pour ton visage :",
      },
      {
        type: "list",
        style: "bullet",
        items: [
          "Haut de l'écran",
          "Bas de l'écran",
          "Zones où apparaissent les légendes et overlays UI",
        ],
      },
      { type: "paragraph", text: "Utilise plusieurs angles pour maintenir l'engagement :" },
      {
        type: "list",
        style: "bullet",
        items: ["Plan large", "Plan moyen", "Gros plan"],
      },
      {
        type: "paragraph",
        text: "Change de plan toutes les quelques secondes pour que la vidéo paraisse plus rapide.",
      },
    ],
  },
  {
    section_id: "sec_cc_hirly",
    title: "Présenter Hirly en vidéo",
    video_url: "",
    content: [
      { type: "heading", level: 2, text: "Montrer le produit (Hirly)" },
      {
        type: "paragraph",
        text: "Quand tu démontres Hirly, mets toujours en avant le swipe en premier — c'est la fonctionnalité centrale.",
      },
      { type: "paragraph", text: "Fonctionnalités importantes à mentionner :" },
      {
        type: "list",
        style: "numbered",
        items: [
          "Upload du CV",
          "Swipe à droite pour postuler en auto",
          "CV / lettre de motivation IA",
          "Onglet historique des candidatures",
        ],
      },
      { type: "paragraph", text: "Meilleur enchaînement :" },
      {
        type: "list",
        style: "numbered",
        items: [
          "Upload du CV",
          "Swipe pour postuler",
          "Mentionne le CV/lettre IA",
          "Montre l'historique des candidatures",
        ],
      },
      { type: "paragraph", text: "Ça rend le processus clair et facile à comprendre." },
      { type: "heading", level: 3, text: "Filmer les démos produit" },
      { type: "paragraph", text: "Meilleures façons de montrer l'app :" },
      {
        type: "list",
        style: "numbered",
        items: [
          "Tuto POV (le meilleur) — filme le téléphone/laptop depuis un autre appareil et parcours les étapes en live",
          "Enregistrement d'écran — utilise un green screen et explique les étapes",
          "Tuto texte — audio trending + texte expliquant les étapes à l'écran",
        ],
      },
      { type: "paragraph", text: "Conseils :" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Montre de grandes entreprises reconnues en swipant (Meta, Google, etc.)",
          "Ça renforce la crédibilité et le sentiment d'identification",
        ],
      },
    ],
    resources: INTRODUCE_HIRLY_RESOURCES_FR,
  },
  {
    section_id: "sec_cc_editing",
    title: "Guide de montage",
    video_url: CREATING_CONTENT_EDITING_VIDEO_URL,
    content: [
      { type: "paragraph", text: "Monte dans CapCut (mobile ou desktop). Suis cet ordre :" },
      { type: "heading", level: 3, text: "1. Import & découpe" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Importe tous les clips du tournage — garde chaque angle filmé.",
          "Coupe et supprime les longues pauses, les « euh », les erreurs et les blancs.",
          "Garde uniquement les prises les plus énergiques. Un montage serré paraît tout de suite plus pro.",
        ],
      },
      { type: "heading", level: 3, text: "2. Jump cuts & rythme" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Utilise des jump cuts dès que l'énergie baisse ou que tu as retiré un passage.",
          "Coupe toutes les 1,5–3 secondes sur les Shorts — le rythme rapide retient l'attention.",
          "Garde les pauses seulement pour les punchlines ou le timing comique.",
        ],
      },
      { type: "heading", level: 3, text: "3. Alterner les angles" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Alterne plan large, moyen et gros plan toutes les quelques secondes.",
          "Aligne le regard entre les clips pour que les coupes soient fluides, pas saccadées.",
          "Ajoute un léger zoom 10–20 % entre les clips si tu n'as qu'un seul angle.",
        ],
      },
      { type: "heading", level: 3, text: "4. Ajustements de vitesse" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Ralentis le B-roll ou les plans d'action à 0,5–1× quand le format le demande.",
          "N'accélère pas la voix face caméra — ça sonne artificiel.",
          "Réserve les changements de vitesse aux plans visuels, pas à la voix principale.",
        ],
      },
      { type: "heading", level: 3, text: "5. Audio & son trending" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Ajoute un son trending à faible volume sous ta voix quand le format utilise de la musique.",
          "Garde ta voix claire et plus forte que la piste de fond.",
          "Synchronise les coupes sur le beat pour les formats musicaux (Good/Better/Best, sons trending, etc.).",
        ],
      },
      { type: "heading", level: 3, text: "6. Texte à l'écran & hooks" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Ajoute un hook texte dans les 1–2 premières secondes si le hook verbal a besoin d'un renfort.",
          "Fais apparaître les phrases clés pendant que tu parles — surtout pour les démos produit (affiche « Hirly » à l'écran).",
          "Garde le texte dans les zones safe — évite le haut et le bas où se superposent les UI TikTok/IG.",
        ],
      },
      { type: "heading", level: 3, text: "7. Sous-titres dans la vidéo" },
      { type: "paragraph", text: "Important : ~50 % des spectateurs regardent sans le son." },
      { type: "paragraph", text: "Bonnes pratiques :" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Utilise les sous-titres auto avec la police Custom/Standard",
          "Max 1–2 lignes — évite les blocs énormes de 3–4 lignes",
          "Place les sous-titres centrés, pas sur les bords",
        ],
      },
      ...postingHoursBlocks("fr"),
    ],
  },
];
