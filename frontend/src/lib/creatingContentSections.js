/** Creating Content sub-chapters (mirrors backend training_module_content.py). */

import { postingHoursBlocks } from "./trainingPostingHours";

export const CREATING_CONTENT_SECTIONS_EN = [
  {
    section_id: "sec_cc_filming",
    title: "Filming Playbook",
    video_url: "",
    content: [
      { type: "heading", level: 1, text: "Talking Head Best Practices" },
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
      { type: "paragraph", text: "Use: eyebrow raises, smirks, eye rolls, awkward reactions, dramatic expressions." },
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
        items: ["7–60 seconds total", "Under 45 seconds for new creators or new accounts"],
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
  },
  {
    section_id: "sec_cc_editing",
    title: "Editing Playbook",
    video_url: "",
    content: [],
  },
];

export const CREATING_CONTENT_SECTIONS_FR = [
  {
    section_id: "sec_cc_filming",
    title: "Guide de tournage",
    video_url: "",
    content: [
      { type: "heading", level: 1, text: "Bonnes pratiques face caméra" },
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
      { type: "heading", level: 3, text: "2. Ton & delivery" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Son naturel, casual, un peu plus drôle et expressif que d'habitude.",
          "Parle comme en FaceTime avec un pote, en partageant du gossip.",
          "Si ça sonne récité ou comme si tu lisais un script, refais la prise.",
        ],
      },
      { type: "heading", level: 3, text: "3. Expressions faciales" },
      { type: "paragraph", text: "Ton visage vend la vidéo — l'exagération aide." },
      {
        type: "paragraph",
        text: "Utilise : sourcils levés, smirks, rolls des yeux, réactions awkward, expressions dramatiques.",
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
          "Si le rythme est lent, les viewers scrollent vite.",
        ],
      },
      { type: "heading", level: 3, text: "5. Durée de la vidéo" },
      { type: "paragraph", text: "Durée recommandée :" },
      {
        type: "list",
        style: "bullet",
        items: ["7–60 secondes au total", "Moins de 45 secondes pour les nouveaux créateurs ou comptes récents"],
      },
      { type: "paragraph", text: "Les vidéos courtes performent mieux pour la croissance et la rétention." },
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
      { type: "heading", level: 3, text: "7. Sous-titres dans la vidéo" },
      { type: "paragraph", text: "Important : ~50 % des viewers regardent sans le son." },
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
      { type: "paragraph", text: "Meilleur flow :" },
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
      { type: "paragraph", text: "Tips :" },
      {
        type: "list",
        style: "bullet",
        items: [
          "Montre de grandes entreprises reconnues en swipant (Meta, Google, etc.)",
          "Ça augmente la crédibilité et la relatability",
        ],
      },
    ],
  },
  {
    section_id: "sec_cc_editing",
    title: "Guide de montage",
    video_url: "",
    content: [],
  },
];
