"""Structured doc content for training modules (Notion-style blocks)."""

POSTING_HOURS_EN = [
    {"type": "heading", "level": 2, "text": "Best Posting (US)"},
    {"type": "paragraph", "text": "Post only during:"},
    {"type": "list", "style": "bullet", "items": [
        "7–9 AM ET",
        "11 AM–1 PM ET",
        "6–9 PM ET",
    ]},
    {"type": "paragraph", "text": "Avoid posting during US sleeping hours or random timezone posting."},
]

POSTING_HOURS_FR = [
    {"type": "heading", "level": 2, "text": "Meilleurs horaires de publication (France — CET/CEST)"},
    {"type": "paragraph", "text": "Poste uniquement pendant :"},
    {"type": "list", "style": "bullet", "items": [
        "7h–9h (heure de Paris)",
        "12h–14h",
        "19h–22h",
    ]},
    {"type": "paragraph", "text": "Évite de poster la nuit ou en simulant le fuseau US (ET/PT). Cible ton audience en France et en francophonie — pas les États-Unis."},
]

WARM_UP_PLAYBOOK_EN = [
    {
        "type": "callout",
        "variant": "warning",
        "text": "Before posting — if you just created your account, please follow these rules carefully.",
    },
    {"type": "paragraph", "text": "For job search, career advice & interview content accounts"},
    {"type": "heading", "level": 2, "text": "Why Warmup Matters"},
    {"type": "paragraph", "text": "Fresh accounts have:"},
    {"type": "list", "style": "bullet", "items": [
        "no trust",
        "no audience profile",
        "no behavioral history",
    ]},
    {"type": "paragraph", "text": "If you post too early:"},
    {"type": "list", "style": "bullet", "items": [
        "wrong audience targeting",
        "low reach",
        "dead accounts",
        "inconsistent views",
    ]},
    {
        "type": "callout",
        "variant": "info",
        "text": "Goal = teach TikTok/IG that this is a real US-based account interested in: job search, careers, interviews, resume tips, LinkedIn, recruiting, and hiring content.",
    },
    {"type": "heading", "level": 2, "text": "Phase 0 — Lurker Mode (Days 1–2)"},
    {"type": "heading", "level": 3, "text": "Day 1"},
    {"type": "list", "style": "bullet", "items": [
        "Create account.",
        "DO NOT post.",
        "DO NOT spam follow.",
        "DO NOT edit profile repeatedly.",
    ]},
    {"type": "paragraph", "text": "Search manually:"},
    {"type": "list", "style": "bullet", "items": [
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
    ]},
    {"type": "paragraph", "text": "Actions:"},
    {"type": "list", "style": "bullet", "items": [
        "watch videos fully",
        "rewatch some clips",
        "like only 5–10 posts",
        "follow 0–3 people max",
    ]},
    {"type": "paragraph", "text": "Spend: 30–45 mins total, split into multiple sessions."},
    {"type": "paragraph", "text": "ONLY interact with:"},
    {"type": "list", "style": "bullet", "items": [
        "US creators",
        "English content",
        "career / job search / interview niche",
    ]},
    {"type": "paragraph", "text": "Avoid:"},
    {"type": "list", "style": "bullet", "items": [
        "meme content",
        "random entertainment",
        "local/non-US creators",
        "mixed niches",
    ]},
    {
        "type": "paragraph",
        "text": "Goal: your FYP should slowly become mostly US career creators, recruiting content, job search content, interview clips, and resume/career content.",
    },
    {"type": "heading", "level": 2, "text": "Phase 1 — Train The Algorithm (Days 3–5)"},
    {"type": "paragraph", "text": "Still: no posting, no spam engagement, no mass follows."},
    {"type": "paragraph", "text": "Actions — search niche keywords daily:"},
    {"type": "list", "style": "bullet", "items": [
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
    ]},
    {"type": "paragraph", "text": "Engagement:"},
    {"type": "list", "style": "bullet", "items": [
        "watch videos fully",
        "save some posts",
        "like selectively",
        "1–3 comments per session max",
    ]},
    {"type": "paragraph", "text": "Good comments:"},
    {"type": "list", "style": "bullet", "items": [
        "this explains a lot",
        "great hook",
        "smart strategy",
        "this format works for job search content",
        "never thought about it like this",
    ]},
    {"type": "paragraph", "text": "Avoid: emoji spam, controversial comments, copy-paste comments, bot behavior."},
    {"type": "paragraph", "text": "Spend: 30–60 mins/day."},
    {"type": "heading", "level": 2, "text": "Phase 2 — Controlled Posting (Day 5+)"},
    {"type": "list", "style": "bullet", "items": [
        "Day 5: post 1 video only, continue scrolling naturally",
        "Day 6: post 2 videos, keep engaging normally",
        "Day 7+: 2–4 posts/day max, still use the account daily like a real user",
    ]},
    {"type": "paragraph", "text": "Dead accounts usually only post, never browse, or spam upload."},
    {"type": "heading", "level": 2, "text": "Healthy Account Signals"},
    {"type": "list", "style": "bullet", "items": [
        "700+ views = healthy",
        "300–700 = still testing",
        "under 300 repeatedly = likely compromised account",
    ]},
    {"type": "paragraph", "text": "Do not judge from 1 video only."},
    {"type": "heading", "level": 2, "text": "Golden Rule"},
    {"type": "paragraph", "text": "Warmup is not about views. Warmup is about trust, audience alignment, stable reach, and long-term scaling. Rush the process = dead accounts."},
    *POSTING_HOURS_EN,
    {"type": "heading", "level": 2, "text": "Warmup Killers"},
    {"type": "list", "style": "bullet", "items": [
        "posting immediately",
        "mixed niche scrolling",
        "spam following",
        "changing GEO/IP",
        "editing bio constantly",
        "posting 10 videos/day instantly",
        "copied/reused content",
        "bot scrolling behavior",
    ]},
]

WARM_UP_PLAYBOOK_FR = [
    {
        "type": "callout",
        "variant": "warning",
        "text": "Avant de publier — si tu viens de créer ton compte, suis ces règles attentivement.",
    },
    {"type": "paragraph", "text": "Pour les comptes de contenu emploi, carrière et entretiens (marché francophone — France)"},
    {"type": "heading", "level": 2, "text": "Pourquoi le warmup compte"},
    {"type": "paragraph", "text": "Les nouveaux comptes n'ont pas :"},
    {"type": "list", "style": "bullet", "items": [
        "de crédibilité",
        "de profil d'audience",
        "d'historique comportemental",
    ]},
    {"type": "paragraph", "text": "Si tu postes trop tôt :"},
    {"type": "list", "style": "bullet", "items": [
        "mauvais ciblage audience",
        "faible portée",
        "comptes morts",
        "vues incohérentes",
    ]},
    {
        "type": "callout",
        "variant": "info",
        "text": "Objectif = montrer à TikTok/IG un vrai compte basé en France intéressé par : emploi, carrière, entretiens, CV, alternance, stage, LinkedIn et recrutement — en français.",
    },
    {"type": "heading", "level": 2, "text": "Phase 0 — Mode lurker (Jours 1–2)"},
    {"type": "heading", "level": 3, "text": "Jour 1"},
    {"type": "list", "style": "bullet", "items": [
        "Crée le compte.",
        "NE PAS publier.",
        "NE PAS follow en masse.",
        "NE PAS modifier le profil en boucle.",
    ]},
    {"type": "paragraph", "text": "Recherche manuelle (en français) : marché de l'emploi, conseils CV, entretien d'embauche, conseils carrière, alternance, stage, télétravail, recrutement, etc."},
    {"type": "paragraph", "text": "30–45 min au total, en plusieurs sessions. Interagis uniquement avec des créateurs francophones et du contenu carrière en français (France, Belgique, Suisse, Canada FR)."},
    {"type": "heading", "level": 2, "text": "Phase 1 — Entraîner l'algorithme (Jours 3–5)"},
    {"type": "paragraph", "text": "Toujours pas de publication. Cherche chaque jour (en français) : conseils recherche emploi, conseils CV, profil LinkedIn, préparation entretien, négociation salaire, CV ATS…"},
    {"type": "paragraph", "text": "30–60 min/jour. 1–3 commentaires max par session, naturels et pertinents."},
    {"type": "paragraph", "text": "Hashtags recommandés : #emploi #job #entretien #alternance #stage #travail #carriere #cv #rechercheemploi #conseilscarriere #jobsearch #emploifrance #tipsemploi (+ #aihirlyai pour le suivi)."},
    {"type": "heading", "level": 2, "text": "Phase 2 — Publication contrôlée (Jour 5+)"},
    {"type": "list", "style": "bullet", "items": [
        "Jour 5 : 1 vidéo",
        "Jour 6 : 2 vidéos",
        "Jour 7+ : 2–4 posts/jour max",
    ]},
    {"type": "heading", "level": 2, "text": "Signaux de compte sain"},
    {"type": "list", "style": "bullet", "items": [
        "700+ vues = sain",
        "300–700 = en test",
        "moins de 300 répété = compte probablement compromis",
    ]},
    {"type": "heading", "level": 2, "text": "Règle d'or"},
    {"type": "paragraph", "text": "Le warmup, ce n'est pas les vues. C'est la crédibilité, l'alignement de l'audience et une portée stable. Brûler les étapes = comptes morts."},
    *POSTING_HOURS_FR,
    {"type": "heading", "level": 2, "text": "Ce qui tue le warmup"},
    {"type": "list", "style": "bullet", "items": [
        "publier immédiatement",
        "scroller dans des niches variées",
        "spam de follows",
        "changer de GEO/IP",
        "modifier la bio en boucle",
        "10 vidéos/jour d'un coup",
        "contenu copié ou réutilisé",
        "comportement de bot",
    ]},
]

FILMING_PLAYBOOK_EN = [
    {"type": "paragraph", "text": "Make sure:"},
    {"type": "heading", "level": 3, "text": "1. Hook (First 3 Seconds Matter Most)"},
    {"type": "list", "style": "bullet", "items": [
        "Get straight to the point immediately — no slow buildup.",
        "Use emotion or action to grab attention.",
    ]},
    {"type": "paragraph", "text": "Good hooks often include:"},
    {"type": "list", "style": "bullet", "items": [
        "Passionate talking, dramatic expressions, complaining or ranting",
        "Doing something else on the side like eating snacks or cutting fruit while talking (creates action)",
    ]},
    {"type": "paragraph", "text": "The goal is to stop the scroll instantly."},
    {"type": "heading", "level": 3, "text": "2. Tone & Delivery"},
    {"type": "list", "style": "bullet", "items": [
        "Sound natural, casual, and be slightly funnier + more expressive than your normal self.",
        "Talk like you're FaceTiming a friend and sharing gossip or tea.",
        "If it sounds rehearsed or like you're reading a script, redo the take.",
    ]},
    {"type": "heading", "level": 3, "text": "3. Facial Expressions"},
    {"type": "paragraph", "text": "Your face sells the video, so exaggeration helps."},
    {"type": "paragraph", "text": "Use: eyebrow raises, smirks, eye rolls, awkward reactions, dramatic expressions."},
    {"type": "paragraph", "text": "These create visual engagement even without sound."},
    {"type": "heading", "level": 3, "text": "4. Pacing"},
    {"type": "list", "style": "bullet", "items": [
        "Speak slightly faster than normal conversation speed.",
        "Avoid long pauses.",
        "Only pause for punchlines or comedic timing.",
        "If pacing is slow, viewers will scroll away quickly.",
    ]},
    {"type": "heading", "level": 3, "text": "5. Video Length"},
    {"type": "paragraph", "text": "Recommended length:"},
    {"type": "list", "style": "bullet", "items": [
        "7–45 seconds total",
        "Under 30 seconds for new creators or new accounts",
    ]},
    {"type": "paragraph", "text": "Shorter videos perform better for growth and retention."},
    {"type": "heading", "level": 3, "text": "6. Framing & Camera Shots"},
    {"type": "paragraph", "text": "Avoid the death zone. Use the safe center zone for your face:"},
    {"type": "list", "style": "bullet", "items": [
        "Top of the screen",
        "Bottom of the screen",
        "Areas where captions and UI overlays appear",
    ]},
    {"type": "paragraph", "text": "Use multiple angles to maintain engagement:"},
    {"type": "list", "style": "bullet", "items": [
        "Long shot",
        "Medium shot",
        "Close-up shot",
    ]},
    {"type": "paragraph", "text": "Switch shots every few seconds to make the video feel faster."},
]

EDITING_PLAYBOOK_EN = [
    {"type": "paragraph", "text": "Edit in CapCut (mobile or desktop). Follow this order:"},
    {"type": "heading", "level": 3, "text": "1. Import & Trim"},
    {"type": "list", "style": "bullet", "items": [
        "Import all clips from filming — keep every angle you shot.",
        "Split and delete long pauses, \"ums,\" mistakes, and dead air.",
        "Keep only the high-energy takes. Tighter trims feel more professional instantly.",
    ]},
    {"type": "heading", "level": 3, "text": "2. Jump Cuts & Pacing"},
    {"type": "list", "style": "bullet", "items": [
        "Use jump cuts wherever energy dips or you removed a section.",
        "Cut every 1.5–3 seconds on Shorts — fast pacing keeps viewers watching.",
        "Only keep pauses for punchlines or comedic timing.",
    ]},
    {"type": "heading", "level": 3, "text": "3. Cut Between Angles"},
    {"type": "list", "style": "bullet", "items": [
        "Alternate between long, medium, and close-up shots every few seconds.",
        "Match your eye line between clips so cuts feel smooth, not jarring.",
        "Add a light 10–20% zoom in or out between clips if you only have one angle.",
    ]},
    {"type": "heading", "level": 3, "text": "4. Speed Adjustments"},
    {"type": "list", "style": "bullet", "items": [
        "Slow B-roll or action clips to 0.5–1× when the format calls for it.",
        "Do not speed up talking-head dialogue — it sounds unnatural.",
        "Use speed changes on visual clips only, not your main voiceover.",
    ]},
    {"type": "heading", "level": 3, "text": "5. Audio & Trending Sound"},
    {"type": "list", "style": "bullet", "items": [
        "Add trending audio at low volume under your voice when the format uses music.",
        "Keep your voice clear and louder than the background track.",
        "Sync cuts to the beat on music-driven formats (Good/Better/Best, trending songs, etc.).",
    ]},
    {"type": "heading", "level": 3, "text": "6. On-Screen Text & Hooks"},
    {"type": "list", "style": "bullet", "items": [
        "Add a text hook in the first 1–2 seconds if the verbal hook needs reinforcement.",
        "Pop up key phrases as you speak — especially for product demos (include \"Hirly\" on screen).",
        "Keep text inside safe zones — avoid the top and bottom UI overlay areas.",
    ]},
    {"type": "heading", "level": 3, "text": "7. In-Video Captions"},
    {"type": "paragraph", "text": "Important because ~50% of viewers watch without sound."},
    {"type": "paragraph", "text": "Best practices:"},
    {"type": "list", "style": "bullet", "items": [
        "Use auto captions with the font named Custom/Standard",
        "Keep captions to 1–2 lines max — avoid huge 3–4 text blocks",
        "Place captions centered, not on edges",
    ]},
    *POSTING_HOURS_EN,
]

HIRLY_IN_VIDEOS_EN = [
    {"type": "heading", "level": 2, "text": "Showing the Product (Hirly)"},
    {"type": "paragraph", "text": "When demonstrating Hirly, always highlight the swiping feature first because it's the core functionality."},
    {"type": "paragraph", "text": "Important features to mention:"},
    {"type": "list", "style": "numbered", "items": [
        "Upload resume",
        "Swipe right to auto-apply",
        "AI resume / cover letter",
        "Application history tab",
    ]},
    {"type": "paragraph", "text": "Best flow:"},
    {"type": "list", "style": "numbered", "items": [
        "Upload resume",
        "Swipe to apply",
        "Mention AI resume/cover letter",
        "Show application history",
    ]},
    {"type": "paragraph", "text": "This makes the process clear and easy to understand."},
    {"type": "heading", "level": 3, "text": "Filming Product Demonstrations"},
    {"type": "paragraph", "text": "Best ways to show the app:"},
    {"type": "list", "style": "numbered", "items": [
        "POV Tutorial (Best) — film the phone/laptop from another device and walk through the steps live",
        "Screen Recording — use green screen and explain the steps",
        "Text Tutorial — use trendy audio and add text explaining steps on screen",
    ]},
    {"type": "paragraph", "text": "Tips:"},
    {"type": "list", "style": "bullet", "items": [
        "Show big recognizable companies when swiping (Meta, Google, etc.)",
        "This increases relatability and credibility",
    ]},
]

FILMING_PLAYBOOK_FR = [
    {"type": "paragraph", "text": "Points essentiels : hook en 3 secondes, ton naturel, expressions exagérées, rythme rapide, vidéos courtes (7–45 s, max 30 s pour débutants), cadrage varié."},
]

EDITING_PLAYBOOK_FR = [
    {"type": "paragraph", "text": "Monte dans CapCut (mobile ou desktop). Suis cet ordre :"},
    {"type": "heading", "level": 3, "text": "1. Import & découpe"},
    {"type": "list", "style": "bullet", "items": [
        "Importe tous les clips du tournage — garde chaque angle filmé.",
        "Coupe et supprime les longues pauses, les « euh », les erreurs et les blancs.",
        "Garde uniquement les prises les plus énergiques. Un montage serré paraît tout de suite plus pro.",
    ]},
    {"type": "heading", "level": 3, "text": "2. Jump cuts & rythme"},
    {"type": "list", "style": "bullet", "items": [
        "Utilise des jump cuts dès que l'énergie baisse ou que tu as retiré un passage.",
        "Coupe toutes les 1,5–3 secondes sur les Shorts — le rythme rapide retient l'attention.",
        "Garde les pauses seulement pour les punchlines ou le timing comique.",
    ]},
    {"type": "heading", "level": 3, "text": "3. Alterner les angles"},
    {"type": "list", "style": "bullet", "items": [
        "Alterne plan large, moyen et gros plan toutes les quelques secondes.",
        "Aligne le regard entre les clips pour que les coupes soient fluides, pas saccadées.",
        "Ajoute un léger zoom 10–20 % entre les clips si tu n'as qu'un seul angle.",
    ]},
    {"type": "heading", "level": 3, "text": "4. Ajustements de vitesse"},
    {"type": "list", "style": "bullet", "items": [
        "Ralentis le B-roll ou les plans d'action à 0,5–1× quand le format le demande.",
        "N'accélère pas la voix face caméra — ça sonne artificiel.",
        "Réserve les changements de vitesse aux plans visuels, pas à la voix principale.",
    ]},
    {"type": "heading", "level": 3, "text": "5. Audio & son trending"},
    {"type": "list", "style": "bullet", "items": [
        "Ajoute un son trending à faible volume sous ta voix quand le format utilise de la musique.",
        "Garde ta voix claire et plus forte que la piste de fond.",
        "Synchronise les coupes sur le beat pour les formats musicaux (Good/Better/Best, sons trending, etc.).",
    ]},
    {"type": "heading", "level": 3, "text": "6. Texte à l'écran & hooks"},
    {"type": "list", "style": "bullet", "items": [
        "Ajoute un hook texte dans les 1–2 premières secondes si le hook verbal a besoin d'un renfort.",
        "Fais apparaître les phrases clés pendant que tu parles — surtout pour les démos produit (affiche « Hirly » à l'écran).",
        "Garde le texte dans les zones safe — évite le haut et le bas où se superposent les UI TikTok/IG.",
    ]},
    {"type": "heading", "level": 3, "text": "7. Sous-titres dans la vidéo"},
    {"type": "paragraph", "text": "Important : ~50 % des spectateurs regardent sans le son."},
    {"type": "paragraph", "text": "Bonnes pratiques :"},
    {"type": "list", "style": "bullet", "items": [
        "Utilise les sous-titres auto avec la police Custom/Standard",
        "Max 1–2 lignes — évite les blocs énormes de 3–4 lignes",
        "Place les sous-titres centrés, pas sur les bords",
    ]},
    *POSTING_HOURS_FR,
]

HIRLY_IN_VIDEOS_FR = [
    {"type": "heading", "level": 2, "text": "Montrer Hirly dans tes vidéos"},
    {"type": "paragraph", "text": "Commence par le swipe pour postuler, puis CV, lettre IA et historique des candidatures. Montre de grandes entreprises (Meta, Google) pour la crédibilité."},
]


def _tag(text: str, color: str):
    return {"type": "tag", "text": text, "color": color}


_FR_TAGS = {
    "upload": _tag("Importer ton CV", "yellow"),
    "ai": _tag("Lettre + CV IA", "blue"),
    "swipe": _tag("Fonction swipe", "pink"),
    "history": _tag("Onglet Historique", "purple"),
}

_EN_TAGS = {
    "upload": _tag("Upload your resume", "yellow"),
    "ai": _tag("AI cover letter/resume", "blue"),
    "swipe": _tag("Swiping feature", "pink"),
    "history": _tag("History tab", "purple"),
}

INTRODUCE_HIRLY_RESOURCES_FR = [
    {"type": "heading", "level": 4, "text": "Fonctionnalités principales + script"},
    {
        "type": "table",
        "columns": ["Fonctionnalités", "Script"],
        "rows": [
            [_FR_TAGS["upload"], ["Tout ce que t'as à faire, c'est importer ton CV.", "Importe simplement ton CV."]],
            [
                _FR_TAGS["ai"],
                [
                    "Active la lettre de motivation et le CV générés par l'IA.",
                    "L'IA génère même une lettre de motivation et un CV personnalisés pour chaque candidature.",
                    "Elle adapte automatiquement ton CV et ta lettre de motivation à chaque offre.",
                ],
            ],
            [
                _FR_TAGS["swipe"],
                [
                    "À chaque fois que tu swipes à droite, l'IA postule automatiquement pour toi sur le site de l'entreprise.",
                    "Tu swipes à droite, et la candidature est envoyée automatiquement.",
                ],
            ],
            [
                _FR_TAGS["history"],
                [
                    "Regarde, j'ai postulé à toutes ces offres en seulement 10 minutes.",
                    "Là, tu peux voir toutes mes candidatures précédentes.",
                    "Tu peux aussi suivre l'avancement et le statut de chacune de tes candidatures.",
                ],
            ],
        ],
    },
    {"type": "heading", "level": 4, "text": "Façons de présenter Hirly"},
    {
        "type": "table",
        "columns": ["", "Variation 1", "Variation 2", "Variation 3"],
        "rows": [
            [{"type": "label", "text": "Court"}, [_FR_TAGS["upload"], _FR_TAGS["swipe"]], [], []],
            [
                {"type": "label", "text": "Moyen"},
                [_FR_TAGS["upload"], _FR_TAGS["ai"], _FR_TAGS["swipe"]],
                [_FR_TAGS["upload"], _FR_TAGS["swipe"], _FR_TAGS["history"]],
                [_FR_TAGS["upload"], _FR_TAGS["swipe"], _FR_TAGS["ai"]],
            ],
            [
                {"type": "label", "text": "Long"},
                [_FR_TAGS["upload"], _FR_TAGS["ai"], _FR_TAGS["swipe"], _FR_TAGS["history"]],
                [_FR_TAGS["upload"], _FR_TAGS["swipe"], _FR_TAGS["ai"], _FR_TAGS["history"]],
                [],
            ],
        ],
    },
    {"type": "heading", "level": 4, "text": "Exemples vidéo"},
    {
        "type": "callout",
        "variant": "info",
        "text": "Ouvre chaque thème pour voir les exemples. Quand il existe une version courte et une version longue, les deux sont listées.",
    },
    {
        "type": "accordion",
        "items": [
            {
                "title": "Swipe",
                "content": [
                    {
                        "type": "paragraph",
                        "text": "Montre le swipe à droite — c'est la fonctionnalité centrale à mettre en avant tôt dans la vidéo.",
                    },
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_swiping/fr.mp4", "upload_label": "Swipe", "aspect": "9:16", "upload_slot": "sec_cb_swiping"},
                ],
            },
            {
                "title": "Historique",
                "content": [
                    {
                        "type": "paragraph",
                        "text": "Prouve le volume et le suivi des candidatures — idéal en hook ou en fin de vidéo.",
                    },
                    {"type": "heading", "level": 4, "text": "Version courte"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_history_short/fr.mp4", "upload_label": "Historique — court", "aspect": "9:16", "upload_slot": "sec_cb_history_short"},
                    {"type": "heading", "level": 4, "text": "Version longue"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_history_long/fr.mp4", "upload_label": "Historique — long", "aspect": "9:16", "upload_slot": "sec_cb_history_long"},
                ],
            },
            {
                "title": "CV & lettre IA",
                "content": [
                    {
                        "type": "paragraph",
                        "text": "Montre que Hirly adapte le CV et génère la lettre pour chaque offre.",
                    },
                    {"type": "heading", "level": 4, "text": "CV — version courte"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_cv_short/fr.mp4", "upload_label": "CV — court", "aspect": "9:16", "upload_slot": "sec_cb_cv_short"},
                    {"type": "heading", "level": 4, "text": "CV — version longue"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_cv_long/fr.mp4", "upload_label": "CV — long", "aspect": "9:16", "upload_slot": "sec_cb_cv_long"},
                    {"type": "heading", "level": 4, "text": "Lettre de motivation IA"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_cover_letter_ai/fr.mp4", "upload_label": "Lettre IA", "aspect": "9:16", "upload_slot": "sec_cb_cover_letter_ai"},
                ],
            },
            {
                "title": "Formats de tournage",
                "content": [
                    {
                        "type": "paragraph",
                        "text": "Exemples selon comment tu filmes la démo à l'écran.",
                    },
                    {"type": "heading", "level": 4, "text": "Green screen — sans téléphone ni ordinateur"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_green_screen/fr.mp4", "upload_label": "Green screen", "aspect": "9:16", "upload_slot": "sec_cb_green_screen"},
                    {"type": "link", "text": "Tuto green screen (TikTok)", "href": "https://www.tiktok.com/@thesocialcreativesclub/video/7338507673932942625?lang=fr"},
                    {"type": "heading", "level": 4, "text": "Avec ordinateur portable"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_laptop_example/fr.mp4", "upload_label": "Ordinateur portable", "aspect": "9:16", "upload_slot": "sec_cb_laptop_example"},
                    {"type": "heading", "level": 4, "text": "Ordinateur portable — sans parole"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_laptop_without_talking/fr.mp4", "upload_label": "Laptop sans parole", "aspect": "9:16", "upload_slot": "sec_cb_laptop_without_talking"},
                    {"type": "heading", "level": 4, "text": "Avec téléphone ou tablette"},
                    {"type": "short_video", "video_url": "/training-videos/course_job_search_mastery/mod_content_bank/sec_cb_tablet_example/fr.mp4", "upload_label": "Téléphone ou tablette", "aspect": "9:16", "upload_slot": "sec_cb_tablet_example"},
                ],
            },
        ],
    },
]

INTRODUCE_HIRLY_RESOURCES_EN = [
    {"type": "heading", "level": 4, "text": "Main features + script"},
    {
        "type": "table",
        "columns": ["Fonctionnalités", "Script"],
        "rows": [
            [_EN_TAGS["upload"], ["All you gotta do is upload your resume", "Just upload your resume"]],
            [
                _EN_TAGS["ai"],
                [
                    "Turn on the AI cover letter and resume",
                    "They even have AI cover letter and resume for EACH swipe",
                    "They TAILOR your resume and cover letter",
                ],
            ],
            [
                _EN_TAGS["swipe"],
                [
                    "Whenever you swipe right, the AI just automatically applies for you on the company website",
                    "When you swipe right it just applies on the website for you",
                ],
            ],
            [
                _EN_TAGS["history"],
                [
                    "Look I applied to all of these in 10 minutes",
                    "Look these are ALL my past applications",
                    "You can also track all your past applications and statuses",
                ],
            ],
        ],
    },
    {"type": "heading", "level": 4, "text": "Ways to introduce Hirly"},
    {
        "type": "table",
        "columns": ["", "Variation 1", "Variation 2", "Variation 3"],
        "rows": [
            [{"type": "label", "text": "Short"}, [_EN_TAGS["upload"], _EN_TAGS["swipe"]], [], []],
            [
                {"type": "label", "text": "Medium"},
                [_EN_TAGS["upload"], _EN_TAGS["ai"], _EN_TAGS["swipe"]],
                [_EN_TAGS["upload"], _EN_TAGS["swipe"], _EN_TAGS["history"]],
                [_EN_TAGS["upload"], _EN_TAGS["swipe"], _EN_TAGS["ai"]],
            ],
            [
                {"type": "label", "text": "Long"},
                [_EN_TAGS["upload"], _EN_TAGS["ai"], _EN_TAGS["swipe"], _EN_TAGS["history"]],
                [_EN_TAGS["upload"], _EN_TAGS["swipe"], _EN_TAGS["ai"], _EN_TAGS["history"]],
                [],
            ],
        ],
    },
]

CREATING_CONTENT_FILMING_VIDEO_URL = (
    "https://player.mediadelivery.net/play/689678/4f0053f4-a610-4fd4-80d0-53ac9f320dfe"
)

CREATING_CONTENT_EDITING_VIDEO_URL = (
    "https://player.mediadelivery.net/play/689678/f53914da-75ae-470e-83c2-fee9896774b0"
)

CREATING_CONTENT_SECTIONS_EN = [
    {
        "section_id": "sec_cc_filming",
        "title": "Filming Playbook",
        "video_url": CREATING_CONTENT_FILMING_VIDEO_URL,
        "content": FILMING_PLAYBOOK_EN,
    },
    {
        "section_id": "sec_cc_hirly",
        "title": "Introducing Hirly in Videos",
        "video_url": "",
        "content": HIRLY_IN_VIDEOS_EN,
        "resources": INTRODUCE_HIRLY_RESOURCES_EN,
    },
    {
        "section_id": "sec_cc_editing",
        "title": "Editing Playbook",
        "video_url": CREATING_CONTENT_EDITING_VIDEO_URL,
        "content": EDITING_PLAYBOOK_EN,
    },
]

CREATING_CONTENT_SECTIONS_FR = [
    {
        "section_id": "sec_cc_filming",
        "title": "Guide de tournage",
        "video_url": CREATING_CONTENT_FILMING_VIDEO_URL,
        "content": FILMING_PLAYBOOK_FR,
    },
    {
        "section_id": "sec_cc_hirly",
        "title": "Présenter Hirly en vidéo",
        "video_url": "",
        "content": HIRLY_IN_VIDEOS_FR,
        "resources": INTRODUCE_HIRLY_RESOURCES_FR,
    },
    {
        "section_id": "sec_cc_editing",
        "title": "Guide de montage",
        "video_url": CREATING_CONTENT_EDITING_VIDEO_URL,
        "content": EDITING_PLAYBOOK_FR,
    },
]
