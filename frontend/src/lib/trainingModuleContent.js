/** Demo / fallback structured doc blocks (mirrors backend training_module_content.py). */

import {
  CREATING_CONTENT_SECTIONS_EN,
  CREATING_CONTENT_SECTIONS_FR,
} from "./creatingContentSections";

import {
  WARM_UP_SECTIONS_EN,
  WARM_UP_SECTIONS_FR,
} from "./warmupSections";

export { CREATING_CONTENT_SECTIONS_EN, CREATING_CONTENT_SECTIONS_FR };

export const WARM_UP_PLAYBOOK_EN = [
  {
    type: "callout",
    variant: "warning",
    text: "Before posting — if you just created your account, please follow these rules carefully.",
  },
  { type: "heading", level: 1, text: "TikTok / IG Warmup SOP" },
  { type: "paragraph", text: "For job search, career advice & interview content accounts" },
  { type: "heading", level: 2, text: "Why Warmup Matters" },
  { type: "paragraph", text: "Fresh accounts have:" },
  { type: "list", style: "bullet", items: ["no trust", "no audience profile", "no behavioral history"] },
  { type: "paragraph", text: "If you post too early:" },
  {
    type: "list",
    style: "bullet",
    items: ["wrong audience targeting", "low reach", "dead accounts", "inconsistent views"],
  },
  {
    type: "callout",
    variant: "info",
    text: "Goal = teach TikTok/IG that this is a real US-based account interested in: job search, careers, interviews, resume tips, LinkedIn, recruiting, and hiring content.",
  },
  { type: "heading", level: 2, text: "Phase 0 — Lurker Mode (Days 1–2)" },
  { type: "heading", level: 3, text: "Day 1" },
  {
    type: "list",
    style: "bullet",
    items: [
      "Create account.",
      "DO NOT post.",
      "DO NOT spam follow.",
      "DO NOT edit profile repeatedly.",
    ],
  },
  { type: "paragraph", text: "Search manually:" },
  {
    type: "list",
    style: "bullet",
    items: [
      "job market",
      "resume tips",
      "resume mistakes",
      "linkedin optimization",
      "job interview",
      "interview tips",
      "salary negotiation",
      "career advice",
      "internship tips",
      "remote jobs",
      "hiring manager",
      "recruitment",
    ],
  },
  { type: "paragraph", text: "Actions:" },
  {
    type: "list",
    style: "bullet",
    items: [
      "watch videos fully",
      "rewatch some clips",
      "like only 5–10 posts",
      "follow 0–3 people max",
    ],
  },
  { type: "paragraph", text: "Spend: 30–45 mins total, split into multiple sessions." },
  { type: "paragraph", text: "ONLY interact with:" },
  {
    type: "list",
    style: "bullet",
    items: ["US creators", "English content", "career / job search / interview niche"],
  },
  { type: "paragraph", text: "Avoid:" },
  {
    type: "list",
    style: "bullet",
    items: ["meme content", "random entertainment", "local/non-US creators", "mixed niches"],
  },
  {
    type: "paragraph",
    text: "Goal: your FYP should slowly become mostly US career creators, recruiting content, job search content, interview clips, and resume/career content.",
  },
  { type: "heading", level: 2, text: "Phase 1 — Train The Algorithm (Days 3–5)" },
  { type: "paragraph", text: "Still: no posting, no spam engagement, no mass follows." },
  { type: "paragraph", text: "Actions — search niche keywords daily:" },
  {
    type: "list",
    style: "bullet",
    items: [
      "job search tips",
      "resume advice",
      "linkedin profile",
      "interview prep",
      "career change",
      "salary negotiation",
      "remote work jobs",
      "hiring process",
      "recruiter tips",
      "ATS resume",
    ],
  },
  { type: "paragraph", text: "Engagement:" },
  {
    type: "list",
    style: "bullet",
    items: [
      "watch videos fully",
      "save some posts",
      "like selectively",
      "1–3 comments per session max",
    ],
  },
  { type: "paragraph", text: "Good comments:" },
  {
    type: "list",
    style: "bullet",
    items: [
      "this explains a lot",
      "great hook",
      "smart strategy",
      "this format works for job search content",
      "never thought about it like this",
    ],
  },
  {
    type: "paragraph",
    text: "Avoid: emoji spam, controversial comments, copy-paste comments, bot behavior.",
  },
  { type: "paragraph", text: "Spend: 30–60 mins/day." },
  { type: "heading", level: 2, text: "Phase 2 — Controlled Posting (Day 5+)" },
  {
    type: "list",
    style: "bullet",
    items: [
      "Day 5: post 1 video only, continue scrolling naturally",
      "Day 6: post 2 videos, keep engaging normally",
      "Day 7+: 2–4 posts/day max, still use the account daily like a real user",
    ],
  },
  {
    type: "paragraph",
    text: "Dead accounts usually only post, never browse, or spam upload.",
  },
  { type: "heading", level: 2, text: "Healthy Account Signals" },
  {
    type: "list",
    style: "bullet",
    items: [
      "700+ views = healthy",
      "300–700 = still testing",
      "under 300 repeatedly = likely compromised account",
    ],
  },
  { type: "paragraph", text: "Do not judge from 1 video only." },
  { type: "heading", level: 2, text: "Golden Rule" },
  {
    type: "paragraph",
    text: "Warmup is not about views. Warmup is about trust, audience alignment, stable reach, and long-term scaling. Rush the process = dead accounts.",
  },
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
  { type: "heading", level: 2, text: "Warmup Killers" },
  {
    type: "list",
    style: "bullet",
    items: [
      "posting immediately",
      "mixed niche scrolling",
      "spam following",
      "changing GEO/IP",
      "editing bio constantly",
      "posting 10 videos/day instantly",
      "copied/reused content",
      "bot scrolling behavior",
    ],
  },
];

export const WARM_UP_PLAYBOOK_FR = [
  {
    type: "callout",
    variant: "warning",
    text: "Avant de publier — si tu viens de créer ton compte, suis ces règles attentivement.",
  },
  { type: "heading", level: 1, text: "SOP Warmup TikTok / IG" },
  { type: "paragraph", text: "Pour les comptes contenu recherche d'emploi, carrière & entretiens" },
  { type: "heading", level: 2, text: "Pourquoi le warmup compte" },
  { type: "paragraph", text: "Les nouveaux comptes n'ont pas :" },
  {
    type: "list",
    style: "bullet",
    items: ["de confiance", "de profil audience", "d'historique comportemental"],
  },
  { type: "paragraph", text: "Si tu postes trop tôt :" },
  {
    type: "list",
    style: "bullet",
    items: ["mauvais ciblage audience", "faible portée", "comptes morts", "vues incohérentes"],
  },
  {
    type: "callout",
    variant: "info",
    text: "Objectif = montrer à TikTok/IG un vrai compte US intéressé par : recherche d'emploi, carrière, entretiens, CV, LinkedIn, recrutement.",
  },
  { type: "heading", level: 2, text: "Phase 0 — Mode lurker (Jours 1–2)" },
  { type: "heading", level: 3, text: "Jour 1" },
  {
    type: "list",
    style: "bullet",
    items: [
      "Crée le compte.",
      "NE PAS publier.",
      "NE PAS follow en masse.",
      "NE PAS modifier le profil en boucle.",
    ],
  },
  {
    type: "paragraph",
    text: "Recherche manuelle : job market, resume tips, interview tips, career advice, remote jobs, recruitment, etc.",
  },
  {
    type: "paragraph",
    text: "30–45 min au total, en plusieurs sessions. Interagis uniquement avec créateurs US et contenu carrière en anglais.",
  },
  { type: "heading", level: 2, text: "Phase 1 — Entraîner l'algorithme (Jours 3–5)" },
  {
    type: "paragraph",
    text: "Toujours pas de publication. Cherche chaque jour : job search tips, resume advice, linkedin profile, interview prep, salary negotiation, ATS resume…",
  },
  { type: "paragraph", text: "30–60 min/jour. 1–3 commentaires max par session, naturels et pertinents." },
  { type: "heading", level: 2, text: "Phase 2 — Publication contrôlée (Jour 5+)" },
  {
    type: "list",
    style: "bullet",
    items: ["Jour 5 : 1 vidéo", "Jour 6 : 2 vidéos", "Jour 7+ : 2–4 posts/jour max"],
  },
  { type: "heading", level: 2, text: "Signaux de compte sain" },
  {
    type: "list",
    style: "bullet",
    items: [
      "700+ vues = sain",
      "300–700 = en test",
      "moins de 300 répété = compte probablement compromis",
    ],
  },
  { type: "heading", level: 2, text: "Règle d'or" },
  {
    type: "paragraph",
    text: "Le warmup, ce n'est pas les vues. C'est la confiance, l'alignement audience et une portée stable. Brûler les étapes = comptes morts.",
  },
  { type: "heading", level: 2, text: "Meilleurs horaires (US)" },
  {
    type: "list",
    style: "bullet",
    items: ["7–9h ET", "11h–13h ET", "18h–21h ET"],
  },
  { type: "heading", level: 2, text: "Ce qui tue le warmup" },
  {
    type: "list",
    style: "bullet",
    items: [
      "publier immédiatement",
      "scroll multi-niches",
      "follow spam",
      "changer GEO/IP",
      "modifier la bio en boucle",
      "10 vidéos/jour d'un coup",
      "contenu copié",
      "comportement bot",
    ],
  },
];

export function moduleContentFor(moduleId, lang = "en") {
  if (moduleId === "mod_warm_up") {
    return lang === "fr" ? WARM_UP_PLAYBOOK_FR : WARM_UP_PLAYBOOK_EN;
  }
  return null;
}

export function moduleSectionsFor(moduleId, lang = "en") {
  if (moduleId === "mod_warm_up") {
    return lang === "fr" ? WARM_UP_SECTIONS_FR : WARM_UP_SECTIONS_EN;
  }
  if (moduleId === "mod_creating_content") {
    return lang === "fr" ? CREATING_CONTENT_SECTIONS_FR : CREATING_CONTENT_SECTIONS_EN;
  }
  return [];
}

export function moduleExtrasFor(moduleId, lang = "en") {
  return {
    content: moduleContentFor(moduleId, lang) || [],
    sections: moduleSectionsFor(moduleId, lang),
  };
}
