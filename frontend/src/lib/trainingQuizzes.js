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

      q("gs1", "The course is divided into how many main parts?", [

        { id: "a", label: "3 parts — warm-up, content, and payment only" },

        { id: "b", label: "5 parts — warm-up, content creation, account management, submission & payment, resources" },

        { id: "c", label: "7 parts — one per day of the week" },

      ], "b"),

      q("gs2", "If you skip or mishandle the warm-up strategy, you risk:", [

        { id: "a", label: "Hashtags fixing reach within 24 hours" },

        { id: "b", label: "Limited reach or algorithm penalties on your account" },

        { id: "c", label: "Automatic payment after your third post" },

      ], "b"),

      q("gs3", "The English example videos from the US competitor are there to:", [

        { id: "a", label: "Repost as-is to publish faster" },

        { id: "b", label: "Inspire you and provide templates — not to copy in English" },

        { id: "c", label: "Replace the Content Bank scripts entirely" },

      ], "b"),

      q("gs4", "What language must the content you publish be in?", [

        { id: "a", label: "English, to match the reference videos" },

        { id: "b", label: "French, to target France and Francophone countries" },

        { id: "c", label: "Any language as long as Hirly appears on screen" },

      ], "b"),

      q("gs5", "If you have a problem or question during the course, you should:", [

        { id: "a", label: "Wait until you finish every module" },

        { id: "b", label: "Contact the team directly via WhatsApp" },

        { id: "c", label: "Ask publicly in TikTok comments for faster help" },

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

        { id: "a", label: "7–45 seconds total; under 30 seconds for new creators/accounts" },

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

      q("sd1", "Where do you submit your finished video?", [

        { id: "a", label: "In Instagram DMs to the Hirly team" },

        { id: "b", label: "Via the Topr link below the module video" },

        { id: "c", label: "By emailing an MP4 to support" },

      ], "b"),

      q("sd2", "Before submitting on Topr, you must:", [

        { id: "a", label: "Post the video on your account first, then paste the post URL" },

        { id: "b", label: "Submit a script PDF only — posting comes later" },

        { id: "c", label: "Receive payment before publishing" },

      ], "a"),

      q("sd3", "Right after you submit on Topr, your video status is:", [

        { id: "a", label: "Live with payment sent immediately" },

        { id: "b", label: "Under review — you get an answer within a few hours" },

        { id: "c", label: "Auto-rejected if the caption is not in English" },

      ], "b"),

      q("sd4", "To receive payment, you need to:", [

        { id: "a", label: "Connect your PayPal email on your Topr profile / balance" },

        { id: "b", label: "Send bank wire details only via WhatsApp" },

        { id: "c", label: "Invoice Hirly manually every month" },

      ], "a"),

      q("sd5", "First time on Topr — the correct flow includes:", [

        { id: "a", label: "Sign up → Creator → join campaign → Create content for this campaign → submit post URL" },

        { id: "b", label: "Skip sign-up and submit without an account" },

        { id: "c", label: "Creator → delete account → resubmit every week" },

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

  quiz_mod_resources: {

    quiz_id: "quiz_mod_resources",

    module_id: "mod_resources",

    title: "Resources — Knowledge Check",

    pass_percent: PASS_PERCENT,

    questions: [

      q("res1", "Where should you always get the official Hirly logo from?", [

        { id: "a", label: "The shared Brand Assets folder linked in this module" },

        { id: "b", label: "Any screenshot taken from the app" },

        { id: "c", label: "A logo you recreated yourself in a design tool" },

      ], "a"),

      q("res2", "Can you recolor or add effects to the Hirly logo before using it?", [

        { id: "a", label: "Yes, any color or effect works" },

        { id: "b", label: "No — use it exactly as provided" },

        { id: "c", label: "Only for sponsored posts" },

      ], "b"),

      q("res3", "Which file format keeps a transparent background for video overlays?", [

        { id: "a", label: "PNG" },

        { id: "b", label: "JPEG" },

        { id: "c", label: "PDF" },

      ], "a"),

    ],

  },

};



const QUIZZES_FR = {

  quiz_mod_getting_started: {

    ...QUIZZES_EN.quiz_mod_getting_started,

    title: "Pour bien commencer — Quiz",

    questions: [

      q("gs1", "La formation est divisée en combien de parties principales ?", [

        { id: "a", label: "3 parties — warmup, contenu et paiement seulement" },

        { id: "b", label: "5 parties — warmup, création de contenu, gestion du compte, soumission & paiement, ressources" },

        { id: "c", label: "7 parties — une par jour de la semaine" },

      ], "b"),

      q("gs2", "Si tu ignores ou rates la stratégie de warmup, tu risques :", [

        { id: "a", label: "Que les hashtags corrigent la portée en 24 h" },

        { id: "b", label: "Une portée limitée ou des pénalités de l'algorithme sur ton compte" },

        { id: "c", label: "Un paiement automatique après ton troisième post" },

      ], "b"),

      q("gs3", "Les vidéos d'exemple en anglais du concurrent américain servent à :", [

        { id: "a", label: "Les republier telles quelles pour aller plus vite" },

        { id: "b", label: "T'inspirer et te donner des modèles — pas à copier en anglais" },

        { id: "c", label: "Remplacer entièrement les scripts de la banque de contenu" },

      ], "b"),

      q("gs4", "Dans quelle langue dois-tu créer le contenu que tu publies ?", [

        { id: "a", label: "En anglais, pour coller aux vidéos de référence" },

        { id: "b", label: "En français, pour cibler la France et les pays francophones" },

        { id: "c", label: "Dans n'importe quelle langue tant que Hirly est à l'écran" },

      ], "b"),

      q("gs5", "Si tu as un problème ou une question pendant la formation, tu dois :", [

        { id: "a", label: "Attendre d'avoir fini tous les modules" },

        { id: "b", label: "Nous contacter directement via WhatsApp" },

        { id: "c", label: "Demander de l'aide publiquement en commentaire TikTok" },

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

        { id: "a", label: "7–45 s au total ; pas plus de 30 s pour débutants/comptes récents" },

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

      q("sd1", "Où soumets-tu ta vidéo terminée ?", [

        { id: "a", label: "En DM Instagram à l'équipe Hirly" },

        { id: "b", label: "Via le lien Topr sous la vidéo du module" },

        { id: "c", label: "Par e-mail en pièce jointe MP4 au support" },

      ], "b"),

      q("sd2", "Avant de soumettre sur Topr, tu dois :", [

        { id: "a", label: "Publier la vidéo sur ton compte, puis coller l'URL du post" },

        { id: "b", label: "Envoyer seulement un PDF du script — la publication vient après" },

        { id: "c", label: "Recevoir le paiement avant de publier" },

      ], "a"),

      q("sd3", "Juste après la soumission sur Topr, le statut de ta vidéo est :", [

        { id: "a", label: "En ligne avec paiement envoyé immédiatement" },

        { id: "b", label: "Under review — tu as une réponse sous quelques heures" },

        { id: "c", label: "Refusée automatiquement si la légende n'est pas en anglais" },

      ], "b"),

      q("sd4", "Pour recevoir ton paiement, tu dois :", [

        { id: "a", label: "Connecter ton e-mail PayPal sur ton profil / balance Topr" },

        { id: "b", label: "Envoyer tes coordonnées bancaires uniquement par WhatsApp" },

        { id: "c", label: "Facturer Hirly manuellement chaque mois" },

      ], "a"),

      q("sd5", "Première fois sur Topr — le bon parcours inclut :", [

        { id: "a", label: "Sign up → Creator → rejoindre la campagne → Create content for this campaign → soumettre l'URL du post" },

        { id: "b", label: "Passer l'inscription et soumettre sans compte" },

        { id: "c", label: "Creator → supprimer le compte → resoumettre chaque semaine" },

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

  quiz_mod_resources: {

    ...QUIZZES_EN.quiz_mod_resources,

    title: "Ressources — Quiz",

    questions: [

      q("res1", "Où dois-tu toujours récupérer le logo officiel Hirly ?", [

        { id: "a", label: "Dans le dossier de ressources de marque partagé dans ce module" },

        { id: "b", label: "N'importe quelle capture d'écran de l'app" },

        { id: "c", label: "Un logo que tu as recréé toi-même" },

      ], "a"),

      q("res2", "Peux-tu recolorer ou ajouter des effets au logo Hirly avant de l'utiliser ?", [

        { id: "a", label: "Oui, n'importe quelle couleur ou effet fonctionne" },

        { id: "b", label: "Non — utilise-le exactement tel quel" },

        { id: "c", label: "Seulement pour les posts sponsorisés" },

      ], "b"),

      q("res3", "Quel format de fichier garde un fond transparent pour les incrustations vidéo ?", [

        { id: "a", label: "PNG" },

        { id: "b", label: "JPEG" },

        { id: "c", label: "PDF" },

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

