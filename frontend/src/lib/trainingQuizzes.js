/** Chapter quizzes — mirrored in backend/training_quizzes.py for scoring. */



const PASS_PERCENT = 67;



function q(id, prompt, options, correctId) {

  return { id, prompt, options, correct: correctId };

}



const QUIZZES_EN = {

  quiz_mod_getting_started: {

    quiz_id: "quiz_mod_getting_started",

    module_id: "mod_getting_started",

    title: "Getting Started — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("gs1", "If you skip Warm Up and post too early, which outcome matches the course?", [

        { id: "a", label: "Hashtag volume fixes reach within 24 hours" },

        { id: "b", label: "Low reach, shadowban risk, or an account that stops scaling" },

        { id: "c", label: "FYP resets after exactly 3 posts regardless of behavior" },

      ], "b"),

      q("gs2", "When can you mark a chapter complete?", [

        { id: "a", label: "After skimming the text — quizzes are optional" },

        { id: "b", label: "Only after passing that chapter's end quiz" },

        { id: "c", label: "After finishing the entire course, not per chapter" },

      ], "b"),

      q("gs3", "Your creator invitation uses a code of how many digits at mobile onboarding?", [

        { id: "a", label: "4 digits" },

        { id: "b", label: "6 digits" },

        { id: "c", label: "8 alphanumeric characters" },

      ], "b"),

      q("gs4", "In demo mode, what happens when you swipe right to apply?", [

        { id: "a", label: "Real applications are sent but marked as drafts" },

        { id: "b", label: "Apply is disabled — no real submissions go to employers" },

        { id: "c", label: "Only 3 demo swipes are allowed per day" },

      ], "b"),

      q("gs5", "Unauthorized sharing of course scripts or screenshots can lead to:", [

        { id: "a", label: "A written warning only — no program consequences" },

        { id: "b", label: "Immediate removal from the creator program" },

        { id: "c", label: "Reduced payment after 30 days" },

      ], "b"),

    ],

  },

  quiz_mod_warm_up: {

    quiz_id: "quiz_mod_warm_up",

    module_id: "mod_warm_up",

    title: "Warm Up — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("wu1", "Phase 0 (Lurker Mode) covers which days on a brand-new account?", [

        { id: "a", label: "Days 1–2 — no posting" },

        { id: "b", label: "Days 3–5 — first posts allowed" },

        { id: "c", label: "Day 1 only — then post 2 videos on Day 2" },

      ], "a"),

      q("wu2", "On Day 1, how many posts should you like according to the SOP?", [

        { id: "a", label: "5–10 posts only" },

        { id: "b", label: "20–30 posts to train the algorithm faster" },

        { id: "c", label: "Every video you watch — like rate does not matter" },

      ], "a"),

      q("wu3", "Day 1 follow limit and Phase 1 daily time budget are:", [

        { id: "a", label: "Follow up to 10 accounts; spend 15–20 min/day" },

        { id: "b", label: "Follow 0–3 people max; Phase 1 = 30–60 min/day" },

        { id: "c", label: "Follow 0–3 people max; Phase 1 = 30–45 min total only" },

      ], "b"),

      q("wu4", "Controlled posting schedule from Day 5 onward:", [

        { id: "a", label: "Day 5: 1 video · Day 6: 2 videos · Day 7+: 2–4 posts/day max" },

        { id: "b", label: "Day 5: 3 videos · Day 6: 5 videos · Day 7+: unlimited" },

        { id: "c", label: "Day 5: 1 video · Day 6: 1 video · Day 7+: 1 post/week" },

      ], "a"),

      q("wu5", "A post at 450 views most likely means:", [

        { id: "a", label: "Healthy account — scale posting to 10/day immediately" },

        { id: "b", label: "Still being tested (300–700 range) — do not panic from one video" },

        { id: "c", label: "Compromised account — delete and restart" },

      ], "b"),

    ],

  },

  quiz_mod_creating_content: {

    quiz_id: "quiz_mod_creating_content",

    module_id: "mod_creating_content",

    title: "Creating Content — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("cc1", "The hook window called out in the Filming Playbook is:", [

        { id: "a", label: "First 3 seconds — no slow buildup" },

        { id: "b", label: "First 10 seconds — establish brand logo first" },

        { id: "c", label: "First 30 seconds — build suspense before the point" },

      ], "a"),

      q("cc2", "Recommended total video length and new-account target:", [

        { id: "a", label: "7–60 seconds total; under 45 seconds for new creators/accounts" },

        { id: "b", label: "45–90 seconds total; always above 60 seconds for authority" },

        { id: "c", label: "3–7 minutes total; short clips hurt retention" },

      ], "a"),

      q("cc3", "Roughly what share of viewers watch without sound?", [

        { id: "a", label: "~50% — captions matter" },

        { id: "b", label: "~10% — audio is optional decoration" },

        { id: "c", label: "~90% — captions are rarely needed" },

      ], "a"),

      q("cc4", "In-video caption best practice from the course:", [

        { id: "a", label: "3–4 lines per block for maximum context" },

        { id: "b", label: "1–2 lines max, centered, Custom/Standard font" },

        { id: "c", label: "No captions — rely on platform auto-translate only" },

      ], "b"),

      q("cc5", "Correct Hirly product demo flow order:", [

        { id: "a", label: "Show application history → swipe → mention AI → upload resume" },

        { id: "b", label: "Upload resume → swipe to apply → mention AI resume/cover letter → show history" },

        { id: "c", label: "Swipe first → skip resume upload → history tab only" },

      ], "b"),

    ],

  },

  quiz_mod_account_management: {

    quiz_id: "quiz_mod_account_management",

    module_id: "mod_account_management",

    title: "Account Management — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("am1", "Baseline daily rhythm after warmup (per account):", [

        { id: "a", label: "1–2 posts/day + 2–3 scroll sessions of 10–15 min each" },

        { id: "b", label: "4–6 posts/day + one 45-minute scroll session weekly" },

        { id: "c", label: "1 post/week + no scrolling unless publishing" },

      ], "a"),

      q("am2", "View-count thresholds from the SOP:", [

        { id: "a", label: "700+ healthy · 300–700 testing · under 300 repeatedly = compromised" },

        { id: "b", label: "1000+ healthy · 500–1000 testing · under 500 = compromised" },

        { id: "c", label: "300+ healthy · 100–300 testing · under 100 = compromised" },

      ], "a"),

      q("am3", "US posting windows listed in the course (ET):", [

        { id: "a", label: "7–9 AM · 11 AM–1 PM · 6–9 PM" },

        { id: "b", label: "5–7 AM · 2–4 PM · 10 PM–midnight" },

        { id: "c", label: "Any time — timezone does not affect distribution" },

      ], "a"),

      q("am4", "Phase 1 engagement cap per scroll session:", [

        { id: "a", label: "1–3 comments max — natural, not bot-like" },

        { id: "b", label: "10–15 comments to signal activity" },

        { id: "c", label: "Unlimited comments if you use emojis" },

      ], "a"),

      q("am5", "Which behavior defines a 'dead account' after warmup?", [

        { id: "a", label: "Opening the app only to publish, then disappearing for weeks" },

        { id: "b", label: "Posting 1–2 times/day with daily scrolling" },

        { id: "c", label: "Getting 650 views on a single post" },

      ], "a"),

    ],

  },

  quiz_mod_submit_drafts: {

    quiz_id: "quiz_mod_submit_drafts",

    module_id: "mod_submit_drafts",

    title: "Submit Drafts — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("sd1", "Required elements before submitting a draft:", [

        { id: "a", label: "Hook, Hirly demo when required, caption matching script guidelines" },

        { id: "b", label: "Logo animation, competitor mention, no Hirly on screen" },

        { id: "c", label: "Hashtags only — script and demo are optional" },

      ], "a"),

      q("sd2", "Why does the program require draft review?", [

        { id: "a", label: "To protect account health and payment eligibility — not to delay you" },

        { id: "b", label: "To batch payments once per quarter" },

        { id: "c", label: "Only for creators under 10k followers" },

      ], "a"),

      q("sd3", "Your account repeatedly posts under 300 views. First response per SOP:", [

        { id: "a", label: "Review Warm Up and Account Management compliance — likely compromised behavior" },

        { id: "b", label: "Post 10 videos the same day to force distribution" },

        { id: "c", label: "Switch niches to meme content for reach" },

      ], "a"),

      q("sd4", "Content must match which source of truth?", [

        { id: "a", label: "The Content Bank script and approved format you selected" },

        { id: "b", label: "Any trending format — scripts are inspiration only" },

        { id: "c", label: "A competitor app's demo flow" },

      ], "a"),

      q("sd5", "If Hirly must appear on screen for a script, you should:", [

        { id: "a", label: "Show Hirly correctly — skipping the demo invalidates the draft" },

        { id: "b", label: "Describe Hirly verbally only — screen not required" },

        { id: "c", label: "Blur the app name to stay subtle" },

      ], "a"),

    ],

  },

  quiz_mod_content_bank: {

    quiz_id: "quiz_mod_content_bank",

    module_id: "mod_content_bank",

    title: "Content Bank — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("cb1", "How should you use Content Bank scripts?", [

        { id: "a", label: "Adapt to your delivery while keeping the core hook and Hirly mentions" },

        { id: "b", label: "Read verbatim with zero changes every time" },

        { id: "c", label: "Ignore scripts — invent unrelated topics for variety" },

      ], "a"),

      q("cb2", "Warm Up post guidelines often specify slowing B-roll to:", [

        { id: "a", label: "0.5–1× speed" },

        { id: "b", label: "2–3× speed only" },

        { id: "c", label: "Never slow footage — always real-time" },

      ], "a"),

      q("cb3", "When demonstrating Hirly, which feature should lead?", [

        { id: "a", label: "Swipe right to auto-apply — core functionality first" },

        { id: "b", label: "Settings page — show account details first" },

        { id: "c", label: "Billing tab — pricing builds trust" },

      ], "a"),

      q("cb4", "Best method to film product demos per the course:", [

        { id: "a", label: "POV tutorial — film the phone/laptop from another device live" },

        { id: "b", label: "Static screenshot collage with no narration" },

        { id: "c", label: "Voiceover only — never show the product UI" },

      ], "a"),

      q("cb5", "Brand name in scripts must stay:", [

        { id: "a", label: "Hirly — do not swap in competitor app names" },

        { id: "b", label: "Generic 'job app' — never say Hirly aloud" },

        { id: "c", label: "Whatever app paid you most recently" },

      ], "a"),

    ],

  },

};



const QUIZZES_FR = {

  quiz_mod_getting_started: {

    ...QUIZZES_EN.quiz_mod_getting_started,

    title: "Pour bien commencer — Quiz",

    questions: [

      q("gs1", "Si tu sautes le warmup et postes trop tôt, quelle issue correspond au cours ?", [

        { id: "a", label: "Les hashtags corrigent la portée en 24 h" },

        { id: "b", label: "Faible portée, risque de shadowban ou compte qui ne scale plus" },

        { id: "c", label: "Le FYP se reset après exactement 3 posts" },

      ], "b"),

      q("gs2", "Quand peux-tu marquer un chapitre comme terminé ?", [

        { id: "a", label: "Après avoir survolé le texte — les quiz sont optionnels" },

        { id: "b", label: "Seulement après avoir réussi le quiz de fin de chapitre" },

        { id: "c", label: "Uniquement à la fin du cours entier" },

      ], "b"),

      q("gs3", "Le code d'invitation créateur en fin d'onboarding mobile compte combien de chiffres ?", [

        { id: "a", label: "4 chiffres" },

        { id: "b", label: "6 chiffres" },

        { id: "c", label: "8 caractères alphanumériques" },

      ], "b"),

      q("gs4", "En mode démo, que se passe-t-il quand tu swipes à droite pour postuler ?", [

        { id: "a", label: "De vraies candidatures partent mais restent en brouillon" },

        { id: "b", label: "Postuler est désactivé — aucune candidature réelle aux entreprises" },

        { id: "c", label: "Seulement 3 swipes démo autorisés par jour" },

      ], "b"),

      q("gs5", "Partager sans autorisation scripts ou captures du cours peut entraîner :", [

        { id: "a", label: "Un simple avertissement écrit" },

        { id: "b", label: "Une exclusion immédiate du programme créateur" },

        { id: "c", label: "Une baisse de paiement après 30 jours" },

      ], "b"),

    ],

  },

  quiz_mod_warm_up: {

    ...QUIZZES_EN.quiz_mod_warm_up,

    title: "Chauffer le compte — Quiz",

    questions: [

      q("wu1", "La Phase 0 (mode lurker) couvre quels jours sur un compte neuf ?", [

        { id: "a", label: "Jours 1–2 — aucune publication" },

        { id: "b", label: "Jours 3–5 — premières publications autorisées" },

        { id: "c", label: "Jour 1 seulement — puis 2 vidéos le jour 2" },

      ], "a"),

      q("wu2", "Le jour 1, combien de posts liker selon la SOP ?", [

        { id: "a", label: "5 à 10 posts seulement" },

        { id: "b", label: "20 à 30 posts pour entraîner l'algo plus vite" },

        { id: "c", label: "Chaque vidéo vue — le taux de like n'a pas d'importance" },

      ], "a"),

      q("wu3", "Limite de follows jour 1 et budget temps Phase 1 :", [

        { id: "a", label: "Jusqu'à 10 follows ; 15–20 min/jour" },

        { id: "b", label: "0 à 3 follows max ; Phase 1 = 30–60 min/jour" },

        { id: "c", label: "0 à 3 follows max ; Phase 1 = 30–45 min total seulement" },

      ], "b"),

      q("wu4", "Calendrier de publication contrôlée à partir du jour 5 :", [

        { id: "a", label: "Jour 5 : 1 vidéo · Jour 6 : 2 vidéos · Jour 7+ : 2–4 posts/jour max" },

        { id: "b", label: "Jour 5 : 3 vidéos · Jour 6 : 5 vidéos · Jour 7+ : illimité" },

        { id: "c", label: "Jour 5 : 1 vidéo · Jour 6 : 1 vidéo · Jour 7+ : 1 post/semaine" },

      ], "a"),

      q("wu5", "Un post à 450 vues signifie le plus probablement :", [

        { id: "a", label: "Compte sain — passe à 10 posts/jour tout de suite" },

        { id: "b", label: "Encore en test (fourchette 300–700) — ne panique pas sur une vidéo" },

        { id: "c", label: "Compte compromis — supprime et recommence" },

      ], "b"),

    ],

  },

  quiz_mod_creating_content: {

    ...QUIZZES_EN.quiz_mod_creating_content,

    title: "Créer du contenu — Quiz",

    questions: [

      q("cc1", "La fenêtre d'accroche du guide de tournage est :", [

        { id: "a", label: "Les 3 premières secondes — pas de montée lente" },

        { id: "b", label: "Les 10 premières secondes — logo d'abord" },

        { id: "c", label: "Les 30 premières secondes — suspense avant le point" },

      ], "a"),

      q("cc2", "Durée totale recommandée et cible nouveaux comptes :", [

        { id: "a", label: "7–60 s au total ; moins de 45 s pour nouveaux créateurs/comptes" },

        { id: "b", label: "45–90 s au total ; toujours plus de 60 s pour l'autorité" },

        { id: "c", label: "3–7 min au total ; les clips courts nuisent à la rétention" },

      ], "a"),

      q("cc3", "Quelle part des viewers regarde sans le son ?", [

        { id: "a", label: "~50 % — les sous-titres comptent" },

        { id: "b", label: "~10 % — l'audio est décoratif" },

        { id: "c", label: "~90 % — sous-titres rarement nécessaires" },

      ], "a"),

      q("cc4", "Bonnes pratiques de sous-titres in-video du cours :", [

        { id: "a", label: "3–4 lignes par bloc pour le contexte" },

        { id: "b", label: "1–2 lignes max, centrées, police Custom/Standard" },

        { id: "c", label: "Pas de sous-titres — auto-traduction plateforme suffit" },

      ], "b"),

      q("cc5", "Ordre correct du flow démo Hirly :", [

        { id: "a", label: "Historique → swipe → IA → upload CV" },

        { id: "b", label: "Upload CV → swipe pour postuler → mention CV/lettre IA → historique" },

        { id: "c", label: "Swipe d'abord → pas d'upload CV → onglet historique seulement" },

      ], "b"),

    ],

  },

  quiz_mod_account_management: {

    ...QUIZZES_EN.quiz_mod_account_management,

    title: "Gestion du compte — Quiz",

    questions: [

      q("am1", "Rythme quotidien de base après warmup (par compte) :", [

        { id: "a", label: "1–2 posts/jour + 2–3 sessions de scroll de 10–15 min" },

        { id: "b", label: "4–6 posts/jour + une session de 45 min par semaine" },

        { id: "c", label: "1 post/semaine + pas de scroll sauf pour publier" },

      ], "a"),

      q("am2", "Seuils de vues de la SOP :", [

        { id: "a", label: "700+ sain · 300–700 en test · moins de 300 répété = compromis" },

        { id: "b", label: "1000+ sain · 500–1000 en test · moins de 500 = compromis" },

        { id: "c", label: "300+ sain · 100–300 en test · moins de 100 = compromis" },

      ], "a"),

      q("am3", "Créneaux de publication France (Paris — CET/CEST) du cours :", [
        { id: "a", label: "7h–9h · 12h–14h · 19h–22h" },
        { id: "b", label: "5h–7h · 15h–17h · 23h–1h" },
        { id: "c", label: "N'importe quand — simuler le fuseau US suffit" },
      ], "a"),

      q("am4", "Plafond de commentaires Phase 1 par session de scroll :", [

        { id: "a", label: "1–3 commentaires max — naturels, pas bot" },

        { id: "b", label: "10–15 commentaires pour signaler l'activité" },

        { id: "c", label: "Commentaires illimités si emojis" },

      ], "a"),

      q("am5", "Quel comportement définit un « compte mort » après warmup ?", [

        { id: "a", label: "Ouvrir l'app uniquement pour publier puis disparaître des semaines" },

        { id: "b", label: "Poster 1–2 fois/jour avec scroll quotidien" },

        { id: "c", label: "Obtenir 650 vues sur un seul post" },

      ], "a"),

    ],

  },

  quiz_mod_submit_drafts: {

    ...QUIZZES_EN.quiz_mod_submit_drafts,

    title: "Soumettre le contenu — Quiz",

    questions: [

      q("sd1", "Éléments requis avant de soumettre un brouillon :", [

        { id: "a", label: "Accroche, démo Hirly si requise, légende conforme au script" },

        { id: "b", label: "Animation logo, mention concurrent, pas de Hirly à l'écran" },

        { id: "c", label: "Hashtags seulement — script et démo optionnels" },

      ], "a"),

      q("sd2", "Pourquoi la relecture des brouillons est obligatoire ?", [

        { id: "a", label: "Protéger la santé du compte et l'éligibilité au paiement — pas te ralentir" },

        { id: "b", label: "Regrouper les paiements une fois par trimestre" },

        { id: "c", label: "Uniquement pour les créateurs sous 10k abonnés" },

      ], "a"),

      q("sd3", "Posts répétés sous 300 vues — première réaction selon la SOP :", [

        { id: "a", label: "Revoir warmup et gestion du compte — comportement probablement compromis" },

        { id: "b", label: "Poster 10 vidéos le même jour pour forcer la distribution" },

        { id: "c", label: "Passer au contenu meme pour la portée" },

      ], "a"),

      q("sd4", "Le contenu doit correspondre à quelle source de vérité ?", [

        { id: "a", label: "Le script et format approuvé de la banque de contenu choisi" },

        { id: "b", label: "N'importe quel format trending — scripts = inspiration" },

        { id: "c", label: "Le flow démo d'une app concurrente" },

      ], "a"),

      q("sd5", "Si Hirly doit apparaître à l'écran pour un script :", [

        { id: "a", label: "Montrer Hirly correctement — sauter la démo invalide le brouillon" },

        { id: "b", label: "Décrire Hirly à l'oral seulement — écran non requis" },

        { id: "c", label: "Flouter le nom de l'app pour rester discret" },

      ], "a"),

    ],

  },

  quiz_mod_content_bank: {

    ...QUIZZES_EN.quiz_mod_content_bank,

    title: "Banque de contenu — Quiz",

    questions: [

      q("cb1", "Comment utiliser les scripts de la banque de contenu ?", [

        { id: "a", label: "Adapter à ton style en gardant l'accroche et les mentions Hirly" },

        { id: "b", label: "Lire mot pour mot sans aucun changement" },

        { id: "c", label: "Ignorer les scripts — sujets non liés pour varier" },

      ], "a"),

      q("cb2", "Les guidelines Warm Up demandent souvent de ralentir le B-roll à :", [

        { id: "a", label: "0,5–1×" },

        { id: "b", label: "2–3× seulement" },

        { id: "c", label: "Jamais ralentir — toujours vitesse réelle" },

      ], "a"),

      q("cb3", "En démo Hirly, quelle fonctionnalité doit passer en premier ?", [

        { id: "a", label: "Swipe à droite pour postuler en auto — fonction centrale" },

        { id: "b", label: "Page paramètres — détails du compte d'abord" },

        { id: "c", label: "Onglet facturation — le pricing crée la confiance" },

      ], "a"),

      q("cb4", "Meilleure méthode pour filmer les démos produit :", [

        { id: "a", label: "Tuto POV — filmer le téléphone/laptop depuis un autre appareil en live" },

        { id: "b", label: "Collage de captures statiques sans voix" },

        { id: "c", label: "Voix off seule — ne jamais montrer l'UI produit" },

      ], "a"),

      q("cb5", "Le nom de marque dans les scripts doit rester :", [

        { id: "a", label: "Hirly — ne pas remplacer par une app concurrente" },

        { id: "b", label: "« App emploi » générique — ne jamais dire Hirly" },

        { id: "c", label: "L'app qui t'a le plus payé récemment" },

      ], "a"),

    ],

  },

};



export function quizForModule(moduleId, lang = "en") {

  const pack = lang === "fr" ? QUIZZES_FR : QUIZZES_EN;

  return pack[`quiz_${moduleId}`] || null;

}



export function scoreQuiz(quiz, answers) {

  if (!quiz?.questions?.length) return { score: 0, passed: false, total: 0, correct: 0 };

  let correct = 0;

  for (const question of quiz.questions) {

    if (answers[question.id] === question.correct) correct += 1;

  }

  const total = quiz.questions.length;

  const score = Math.round((correct / total) * 100);

  const passed = score >= (quiz.pass_percent || PASS_PERCENT);

  return { score, passed, total, correct };

}



export function quizIdForModule(moduleId) {

  return `quiz_${moduleId}`;

}

