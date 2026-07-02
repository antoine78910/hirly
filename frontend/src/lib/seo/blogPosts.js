/**
 * All blog post content for Hirly SEO.
 * Each post follows the pseo.md + aiseo.md rules:
 * - Unique H1 in `title`
 * - metaTitle (without " | Hirly"), ≤ 63 chars so total ≤ 70
 * - metaDescription 150–160 chars
 * - sections array: H2 sections with body paragraphs + optional lists
 * - faq array: 4–6 Q&A
 * - cta: one mid-article CTA and one conclusion CTA
 */
export const blogPosts = [
  {
    slug: "trouver-emploi-rapidement",
    title: "Comment trouver un emploi rapidement sans envoyer 200 CVs",
    metaTitle: "Trouver un emploi rapidement sans envoyer 200 CVs",
    metaDescription: "Méthode concrète pour trouver un emploi en moins de 3 semaines : prioriser les offres, automatiser les candidatures et suivre ses relances efficacement.",
    category: "Recherche d'emploi",
    readTime: "7 min",
    date: "2026-07-03",
    intro: "Envoyer des dizaines de candidatures identiques ne mène généralement nulle part. Les candidats qui décrochent vite ne travaillent pas plus — ils travaillent mieux, en ciblant juste et en automatisant le reste. L'objectif est de maximiser ses chances sans raccourcis douteux ni méthodes qui nuisent à la crédibilité.",
    ctaMid: { text: "Laisse Hirly postuler pour toi", href: "https://hirly.app" },
    ctaEnd: { text: "Commence à swiper tes prochaines offres", href: "https://hirly.app" },
    sections: [
      {
        h2: "Pourquoi envoyer beaucoup de CVs est contre-productif",
        body: [
          "La logique 'volume = résultats' est fausse en recherche d'emploi. Un recruteur voit en quelques secondes si une candidature est générique ou ciblée. Une lettre de motivation copiée-collée, un CV non adapté à la fiche de poste : c'est éliminé avant même d'être lu.",
          "Les données du marché le confirment : le taux de réponse moyen sur une candidature non ciblée est inférieur à 5 %. Sur une candidature adaptée — CV ajusté, LM qui reprend les mots-clés de l'offre — il monte à 20–35 %.",
        ],
        list: [
          "Candidature générique : taux de réponse < 5 %",
          "Candidature ciblée (CV + LM adaptés) : 20–35 %",
          "Candidature via réseau direct : 40–60 %",
        ],
      },
      {
        h2: "La méthode en 4 étapes pour postuler vite et bien",
        body: [
          "Plutôt que de partir sur tous les fronts, concentrez-vous sur 3 à 5 offres par jour, sélectionnées selon des critères précis. La vitesse d'exécution vient ensuite de l'automatisation, pas de la répétition manuelle.",
        ],
        numbered: [
          "Définir 3 critères non négociables (secteur, niveau, localisation ou remote) et filtrer uniquement sur ces critères.",
          "Pour chaque offre retenue, adapter le CV en 3 points : titre du poste, compétences clés reprises dans l'offre, et un exemple chiffré pertinent.",
          "Rédiger une lettre de motivation en 3 paragraphes max : pourquoi ce poste, pourquoi vous, prochaine étape.",
          "Suivre chaque candidature dans un outil dédié pour relancer au bon moment (J+7 si pas de réponse).",
        ],
      },
      {
        h2: "Comment l'IA change la donne pour les candidats",
        body: [
          "Les outils d'IA permettent aujourd'hui de générer un CV et une lettre de motivation adaptés à chaque offre en quelques secondes — sans perdre en qualité. Le principe : vous importez votre profil une fois, l'IA analyse l'offre, et produit une candidature sur-mesure.",
          "Hirly fait exactement ça. Vous swipez sur les offres qui vous correspondent, et l'application génère automatiquement un dossier de candidature personnalisé, puis le soumet directement à l'ATS (Greenhouse, Lever) du recruteur. Résultat : vous postulez à 5 offres en 5 minutes au lieu de 5 heures.",
        ],
      },
      {
        h2: "Les erreurs qui font perdre du temps (et des opportunités)",
        body: [
          "La plupart des candidats perdent un temps considérable sur des détails qui ne changent pas le résultat, et négligent ce qui compte vraiment.",
        ],
        list: [
          "Passer 2h à reformater le CV graphiquement → les ATS ne lisent pas le design, ils lisent le texte",
          "Envoyer la même LM à 30 entreprises → détecté et ignoré",
          "Postuler à tout ce qui correspond vaguement au titre → dilue l'énergie et baisse la qualité",
          "Ne pas relancer → 30–40 % des offres ont un suivi lacunaire côté RH",
          "Ignorer les jobs via ATS direct → c'est là que se passent 70 % des recrutements B2B tech",
        ],
      },
      {
        h2: "Plan d'action 7 jours pour décrocher un entretien",
        body: [
          "Ce plan est conçu pour quelqu'un qui cherche activement un emploi et peut y consacrer 1h30 à 2h par jour.",
        ],
        numbered: [
          "J1 : Mettre à jour son profil LinkedIn et son CV de base. Définir ses 3 critères clés.",
          "J2 : Identifier 10 offres cibles sur les principales plateformes (LinkedIn, Indeed, Welcome to the Jungle). Éliminer les 4 moins pertinentes.",
          "J3–J4 : Postuler aux 6 offres sélectionnées avec CV + LM adaptés à chacune.",
          "J5 : Activer son réseau — envoyer 3 messages personnalisés à des contacts dans des entreprises cibles.",
          "J6 : Créer des alertes sur les plateformes d'emploi et Hirly pour les prochaines offres.",
          "J7 : Relancer les candidatures envoyées J3–J4 si pas de réponse automatique reçue.",
        ],
      },
      {
        h2: "Suivre ses candidatures sans perdre le fil",
        body: [
          "Sans suivi, vous relancez trop tôt, pas assez, ou au mauvais interlocuteur. Un tracker simple — même un tableur — suffit à condition d'y noter : l'entreprise, le poste, la date de candidature, le statut, et la date de relance prévue.",
          "Hirly intègre ce tracker directement dans l'application. Chaque candidature envoyée est suivie en temps réel : statut, historique, et rappels de relance automatiques.",
        ],
      },
    ],
    faq: [
      {
        id: 1,
        question: "En combien de temps peut-on trouver un emploi avec cette méthode ?",
        answer: "Le délai dépend du secteur et du niveau de poste, mais une méthode ciblée permet généralement d'obtenir un premier entretien en 1 à 3 semaines. Les secteurs tech et marketing répondent souvent plus vite.",
      },
      {
        id: 2,
        question: "Faut-il obligatoirement utiliser un outil comme Hirly ?",
        answer: "Non, la méthode fonctionne sans outil. Mais automatiser la génération de candidatures personnalisées et le suivi fait gagner plusieurs heures par semaine, ce qui permet de se concentrer sur la préparation aux entretiens.",
      },
      {
        id: 3,
        question: "Combien de candidatures envoyer par semaine ?",
        answer: "Qualité > quantité. 5 à 10 candidatures ciblées par semaine est une cadence raisonnable et soutenable. Au-delà, la qualité chute et les taux de réponse avec.",
      },
      {
        id: 4,
        question: "Comment adapter son CV rapidement à chaque offre ?",
        answer: "Identifiez les 3 compétences les plus importantes de l'offre et vérifiez qu'elles apparaissent clairement dans votre CV, avec un exemple concret pour chacune. Les outils IA comme Hirly font cette adaptation automatiquement.",
      },
      {
        id: 5,
        question: "Doit-on toujours écrire une lettre de motivation ?",
        answer: "Pour les postes seniors ou dans des entreprises avec un processus RH structuré, oui. Pour les startups et postes tech, une LM courte et directe (3 paragraphes) suffit souvent. L'important est qu'elle soit adaptée à l'offre, pas générique.",
      },
    ],
  },

  {
    slug: "meilleures-apps-emploi-2026",
    title: "Les meilleures apps pour trouver un emploi en 2026",
    metaTitle: "Meilleures apps pour trouver un emploi en 2026",
    metaDescription: "Comparatif honnête des meilleures applications pour trouver un emploi en 2026 : LinkedIn, Indeed, Hirly, Welcome to the Jungle. Critères, forces et limites.",
    category: "Outils",
    readTime: "8 min",
    date: "2026-07-03",
    intro: "Le marché des apps d'emploi a beaucoup évolué ces 3 dernières années. L'IA a changé ce que l'on peut attendre d'un outil de recherche d'emploi. Ce comparatif est honnête — il présente les forces et limites de chaque app, sans publicité déguisée. L'objectif : vous aider à choisir l'outil qui correspond à votre profil et à votre situation.",
    ctaMid: { text: "Essayer Hirly gratuitement", href: "https://hirly.app" },
    ctaEnd: { text: "Commencer avec Hirly", href: "https://hirly.app" },
    sections: [
      {
        h2: "Critères de comparaison",
        body: [
          "Pour comparer ces apps objectivement, nous avons retenu 5 critères qui comptent vraiment pour un candidat actif :",
        ],
        list: [
          "Qualité et fraîcheur des offres d'emploi",
          "Personnalisation de la recherche (filtres, matching)",
          "Aide à la candidature (CV, lettre de motivation, ATS)",
          "Suivi des candidatures",
          "Expérience mobile",
        ],
      },
      {
        h2: "LinkedIn — La référence, mais pas pour tout le monde",
        body: [
          "LinkedIn reste la plateforme la plus utilisée par les recruteurs. Son avantage principal : la visibilité passive. En gardant un profil à jour, vous êtes chassé sans effort. Pour les profils seniors et les postes en entreprise établie, c'est souvent le canal numéro 1.",
          "Les limites : les offres sont souvent ancienneS ou déjà pourvues, le processus de candidature est manuel (formulaire à remplir offre par offre), et les notifications sont intrusives. Pour une recherche active et rapide, LinkedIn seul n'est pas la meilleure solution.",
        ],
        list: [
          "Pour : profils visibles, réseau, chasseurs de têtes",
          "Contre : candidature manuelle et lente, offres parfois obsolètes",
          "Idéal pour : profils seniors, freelances, postes en entreprise",
        ],
      },
      {
        h2: "Indeed — Le volume, mais peu de valeur ajoutée",
        body: [
          "Indeed agrège les offres de centaines de sources. C'est son principal atout : le volume. Pour un candidat qui cherche dans un secteur peu tech ou dans une région spécifique, Indeed est souvent incontournable.",
          "En revanche, l'expérience de candidature est basique. Pas de personnalisation du CV, pas de LM générée, suivi limité. Le modèle push-CV-partout montre ses limites en 2026.",
        ],
        list: [
          "Pour : couverture géographique, volume d'offres, secteurs non-tech",
          "Contre : zéro aide à la candidature, pas de matching IA",
          "Idéal pour : candidats qui cherchent dans des secteurs traditionnels",
        ],
      },
      {
        h2: "Welcome to the Jungle — L'expérience marque employeur",
        body: [
          "Welcome to the Jungle s'est différencié par la qualité des contenus employeurs : vidéos d'entreprise, fiches culture, interviews d'équipes. Pour un candidat qui veut vraiment comprendre l'environnement de travail avant de postuler, c'est une référence.",
          "Les offres sont de bonne qualité, majoritairement tech et startups. La limite : ce n'est pas un outil de candidature rapide. Les processus restent manuels, et la plateforme est plus orientée inspiration que productivité.",
        ],
        list: [
          "Pour : culture d'entreprise, startups, profils tech",
          "Contre : processus de candidature manuel, pas d'automatisation",
          "Idéal pour : candidats qui priorisent la culture et l'environnement",
        ],
      },
      {
        h2: "Hirly — Le matching IA et l'auto-candidature",
        body: [
          "Hirly prend une approche différente : plutôt que de lister des offres et vous laisser postuler manuellement, l'app analyse votre profil, vous propose des jobs avec un score de matching, et génère automatiquement votre candidature (CV adapté + lettre de motivation) pour chaque offre que vous validez par un swipe.",
          "La candidature est soumise directement à l'ATS du recruteur (Greenhouse, Lever) sans que vous ayez à remplir de formulaire. Le tracker intégré suit chaque candidature en temps réel.",
          "La limite actuelle : le catalogue d'offres est plus restreint que LinkedIn ou Indeed, et certains secteurs sont peu couverts (ex. secteur public, commerce de proximité).",
        ],
        list: [
          "Pour : gain de temps, candidatures personnalisées, profils tech et startup",
          "Contre : couverture offres plus étroite, principalement Greenhouse/Lever",
          "Idéal pour : candidats actifs qui cherchent dans la tech, les startups et le SaaS",
        ],
      },
      {
        h2: "Quel outil choisir selon votre profil ?",
        body: [
          "Il n'y a pas d'app universelle. Le bon choix dépend de votre situation :",
        ],
        list: [
          "Profil tech / startup / SaaS en recherche active → Hirly + LinkedIn complémentaire",
          "Reconversion professionnelle → Hirly pour l'automatisation + Welcome pour la culture",
          "Secteurs traditionnels, commerce, industrie → Indeed + LinkedIn",
          "Profil senior visible → LinkedIn en priorité, laisser venir les opportunités",
          "Premier emploi / junior → Hirly + Welcome to the Jungle",
        ],
      },
    ],
    faq: [
      {
        id: 1,
        question: "Quelle app trouve le plus d'offres d'emploi en France ?",
        answer: "Indeed est celle qui agrège le plus grand volume d'offres, toutes catégories confondues. LinkedIn et Welcome to the Jungle ont une meilleure qualité d'offres dans la tech et les startups.",
      },
      {
        id: 2,
        question: "Hirly est-il gratuit ?",
        answer: "Hirly propose un accès gratuit pour débuter. Certaines fonctionnalités avancées (volume de candidatures automatiques, accès prioritaire aux offres) sont disponibles dans les formules payantes.",
      },
      {
        id: 3,
        question: "Peut-on utiliser plusieurs apps en parallèle ?",
        answer: "Oui, et c'est recommandé. Une combinaison efficace : Hirly pour les candidatures actives automatisées, LinkedIn pour la visibilité passive et le réseau.",
      },
      {
        id: 4,
        question: "Ces apps fonctionnent-elles pour les postes en remote ?",
        answer: "Oui, toutes proposent des filtres remote. Hirly et Welcome to the Jungle ont une bonne couverture des postes full-remote dans la tech.",
      },
      {
        id: 5,
        question: "Les ATS bloquent-ils les candidatures automatiques ?",
        answer: "Non, Hirly soumet les candidatures via l'API officielle des ATS (Greenhouse, Lever), exactement comme si vous postuliez manuellement. La candidature est indistinguable d'une soumission manuelle côté recruteur.",
      },
    ],
  },

  {
    slug: "automatiser-recherche-emploi",
    title: "Comment automatiser sa recherche d'emploi en 2026",
    metaTitle: "Comment automatiser sa recherche d'emploi en 2026",
    metaDescription: "Guide pratique pour automatiser sa recherche d'emploi : alertes, génération de CV par IA, soumission ATS automatique et suivi des candidatures en 2026.",
    category: "Productivité",
    readTime: "6 min",
    date: "2026-07-03",
    intro: "Chercher un emploi est chronophage. Adapter son CV, écrire une lettre de motivation, remplir un formulaire ATS, relancer — chaque étape prend du temps. En 2026, une grande partie de ce travail peut être automatisée sans sacrifier la qualité. Voici comment construire une stack d'outils pour postuler plus vite et mieux, sans raccourcis douteux ni méthodes qui nuisent à votre crédibilité.",
    ctaMid: { text: "Tester l'automatisation avec Hirly", href: "https://hirly.app" },
    ctaEnd: { text: "Automatise tes candidatures avec Hirly", href: "https://hirly.app" },
    sections: [
      {
        h2: "Ce qui peut être automatisé dans une recherche d'emploi",
        body: [
          "Tout ne peut pas être délégué à un outil — la préparation aux entretiens, la réflexion sur ses objectifs de carrière, et les décisions finales restent humaines. Mais voici ce qui peut être automatisé sans perte de qualité :",
        ],
        list: [
          "Veille des nouvelles offres (alertes email ou in-app)",
          "Personnalisation du CV en fonction des mots-clés de l'offre",
          "Génération de la lettre de motivation adaptée",
          "Soumission de la candidature à l'ATS",
          "Suivi et relances des candidatures envoyées",
        ],
      },
      {
        h2: "Étape 1 — Automatiser la veille des offres",
        body: [
          "La première étape est de ne plus chercher activement, mais de recevoir les offres pertinentes. Chaque grande plateforme propose des alertes par email (LinkedIn, Indeed, Welcome to the Jungle). La clé est de configurer des alertes précises : titre exact + localisation + niveau d'expérience.",
          "Hirly va plus loin : l'algorithme de matching apprend de vos swipes pour affiner les offres proposées. Moins de bruit, plus de pertinence.",
        ],
        numbered: [
          "Créer une alerte LinkedIn avec votre titre exact + remote ou ville + niveau senior/junior",
          "Créer la même alerte sur Indeed pour couvrir les offres non publiées sur LinkedIn",
          "Activer les notifications Hirly pour les offres avec un score de matching > 80 %",
        ],
      },
      {
        h2: "Étape 2 — Automatiser la personnalisation du CV",
        body: [
          "Le CV générique, c'est terminé. En 2026, les ATS analysent la correspondance entre votre CV et la fiche de poste avant qu'un recruteur ne pose les yeux dessus. Un CV non adapté ne passe pas.",
          "La bonne nouvelle : les outils IA comme Hirly font cette adaptation automatiquement. Vous importez votre profil une fois. Pour chaque offre que vous validez, l'IA identifie les compétences prioritaires de l'offre et les met en avant dans votre CV — sans inventer quoi que ce soit.",
        ],
      },
      {
        h2: "Étape 3 — Automatiser la soumission à l'ATS",
        body: [
          "La plupart des entreprises tech utilisent un ATS (Applicant Tracking System) pour gérer les candidatures : Greenhouse, Lever, Workday, Ashby. Remplir ces formulaires manuellement prend en moyenne 18 minutes par candidature.",
          "Hirly soumet votre candidature directement via l'API officielle de l'ATS. Résultat : votre candidature est dans leur système en quelques secondes, avec le bon format, les bonnes pièces jointes, et sans erreur de formulaire.",
        ],
        list: [
          "Greenhouse : soumission directe via l'API v1",
          "Lever : soumission directe via l'API officielle",
          "Formats acceptés : PDF pour le CV, texte structuré pour la LM",
        ],
      },
      {
        h2: "Étape 4 — Automatiser le suivi et les relances",
        body: [
          "80 % des candidats ne relancent jamais. Pourtant, une relance bien timée (J+7 à J+10) augmente significativement le taux de réponse. Le problème : sans système de suivi, on perd le fil.",
          "Un tracker de candidatures — qu'il soit dans un tableur ou dans Hirly — vous rappelle automatiquement quand relancer, à qui, et avec quel message.",
        ],
      },
      {
        h2: "Les limites de l'automatisation — ce qui reste humain",
        body: [
          "Automatiser ne veut pas dire déléguer sa recherche d'emploi à une machine. Certaines étapes ne doivent pas être automatisées :",
        ],
        list: [
          "La préparation aux entretiens : aucun outil ne remplace la connaissance de l'entreprise et la pratique",
          "La décision finale sur une offre : ne laissez pas un algorithme choisir votre prochain employeur",
          "Les messages de réseau personnalisés : un message généré par IA se reconnaît, et nuit à votre image",
          "La vérification des candidatures avant envoi : toujours relire ce qui part en votre nom",
        ],
      },
    ],
    faq: [
      {
        id: 1,
        question: "L'automatisation des candidatures est-elle bien vue par les recruteurs ?",
        answer: "Une candidature bien personnalisée et soumise via l'API officielle de l'ATS est indistinguable d'une candidature manuelle. Ce qui compte pour le recruteur, c'est la pertinence du profil, pas la méthode d'envoi.",
      },
      {
        id: 2,
        question: "Quels outils utiliser pour automatiser sa recherche d'emploi en 2026 ?",
        answer: "Hirly pour les candidatures automatiques, LinkedIn Job Alerts pour la veille passive, et un tableur ou Notion pour le suivi si vous n'utilisez pas le tracker intégré.",
      },
      {
        id: 3,
        question: "Les ATS détectent-ils les candidatures automatiques ?",
        answer: "Hirly utilise les API officielles des ATS (Greenhouse, Lever). La candidature est soumise exactement comme si vous l'aviez remplie manuellement. Il n'y a pas de détection possible.",
      },
      {
        id: 4,
        question: "Peut-on vraiment automatiser la lettre de motivation ?",
        answer: "Oui, à condition que l'outil dispose de votre profil complet et analyse précisément l'offre. Hirly génère une LM adaptée à chaque offre à partir de votre profil. Elle reste personnalisée, pas générique.",
      },
    ],
  },

  {
    slug: "passer-filtres-ats-recrutement",
    title: "ATS : comment passer les filtres des logiciels de recrutement",
    metaTitle: "ATS : comment passer les filtres des logiciels de recrutement",
    metaDescription: "Comprendre comment fonctionnent les ATS (Greenhouse, Lever, Workday) et adapter son CV pour passer les filtres automatiques et atteindre un recruteur humain.",
    category: "Stratégie",
    readTime: "7 min",
    date: "2026-07-03",
    intro: "Plus de 70 % des grandes entreprises et startups tech utilisent un ATS pour trier les candidatures avant qu'un recruteur humain n'intervienne. Si votre CV n'est pas formaté pour être lu par ces systèmes, vous êtes éliminé avant même d'être vu. Voici comment les ATS fonctionnent, ce qu'ils cherchent, et comment soumettre des candidatures qui passent — sans tricher, juste en comprenant les règles du jeu.",
    ctaMid: { text: "Laisser Hirly soumettre directement à l'ATS", href: "https://hirly.app" },
    ctaEnd: { text: "Postuler via Hirly et bypasser les formulaires", href: "https://hirly.app" },
    sections: [
      {
        h2: "Qu'est-ce qu'un ATS et comment ça fonctionne",
        body: [
          "Un ATS (Applicant Tracking System) est un logiciel qui centralise les candidatures reçues par une entreprise, les classe, et filtre celles qui correspondent à la fiche de poste avant de les présenter au recruteur. Les plus utilisés dans la tech et les startups : Greenhouse, Lever, Workday, Ashby, BambooHR.",
          "Ces systèmes fonctionnent en 3 étapes : parsing (lecture du CV en texte brut), scoring (correspondance CV / fiche de poste), et ranking (classement des candidats). Si votre CV n'est pas parseable correctement, vous perdez des points dès la première étape.",
        ],
        list: [
          "Greenhouse : très répandu dans les startups Series A et au-delà",
          "Lever : préféré des équipes RH qui font du sourcing actif",
          "Workday : entreprises mid-market et grands comptes",
          "Ashby : nouvelles startups tech, UX soignée",
        ],
      },
      {
        h2: "Les erreurs de CV qui font échouer le parsing",
        body: [
          "Le parsing, c'est la lecture automatique de votre CV par l'ATS. Si l'outil ne peut pas lire correctement votre document, les informations sont perdues ou mal interprétées. Voici ce qui pose problème :",
        ],
        list: [
          "CV en format image ou scan : l'ATS ne voit qu'une image, pas du texte",
          "Tableaux et colonnes complexes : désorganisent le parsing",
          "Polices non-standard ou icônes à la place de texte",
          "En-têtes et pieds de page avec des informations clés (certains ATS ne les lisent pas)",
          "PDF avec sécurité activée (protection contre la copie du texte)",
        ],
      },
      {
        h2: "Comment adapter son CV aux mots-clés de l'offre",
        body: [
          "Les ATS comparent votre CV à la fiche de poste via des algorithmes de matching lexical. Plus les mots-clés de l'offre apparaissent dans votre CV (dans un contexte pertinent), plus votre score monte.",
          "La méthode concrète : lisez l'offre, identifiez les 5 à 8 compétences ou outils les plus mentionnés, et vérifiez qu'ils apparaissent dans votre CV avec un contexte clair (pas juste une liste de mots).",
        ],
        numbered: [
          "Copier la description du poste dans un outil de comptage de mots",
          "Identifier les 5–8 termes techniques les plus fréquents",
          "Vérifier qu'ils apparaissent dans votre CV avec une phrase de contexte",
          "Ne pas 'keyword stuff' : intégrer naturellement, dans des expériences réelles",
        ],
      },
      {
        h2: "Le format de CV optimal pour les ATS",
        body: [
          "Un CV ATS-friendly n'est pas forcément beau. Il est lisible, structuré, et en texte pur. Voici les règles de base :",
        ],
        list: [
          "Format PDF (texte, pas image) ou Word",
          "Structure simple : sections claires (Expériences, Compétences, Formation)",
          "Dates au format standard (mois/année ou année)",
          "Titre du poste qui reprend exactement celui de l'offre ou un équivalent direct",
          "Polices standard : Arial, Calibri, Georgia, Times New Roman",
          "Pas de tableaux, colonnes multiples, ou zones de texte",
        ],
      },
      {
        h2: "La solution Hirly : soumission directe via l'API ATS",
        body: [
          "Hirly contourne le problème différemment. Plutôt que d'espérer que votre PDF soit bien parsé, Hirly soumet votre candidature directement via l'API officielle de l'ATS (Greenhouse, Lever). Les données — nom, email, poste visé, CV, lettre de motivation — sont transmises au bon endroit, au bon format, sans passer par le formulaire web.",
          "C'est l'équivalent de ce que fait un recruteur quand il crée un candidat manuellement dans l'ATS : les données arrivent propres, structurées, et correctement catégorisées.",
        ],
      },
      {
        h2: "Vérifier que votre candidature est bien reçue",
        body: [
          "Après avoir postulé, voici comment vérifier que votre candidature est bien dans le système :",
        ],
        numbered: [
          "Vérifier l'email de confirmation : Greenhouse et Lever envoient toujours un accusé de réception",
          "Si pas d'email après 24h : relancer poliment par email ou LinkedIn",
          "Ne pas repostuler avec un profil différent : risque de doublon et de signal négatif",
          "Attendre J+7 à J+10 avant de relancer, pas avant",
        ],
      },
    ],
    faq: [
      {
        id: 1,
        question: "Tous les recruteurs utilisent-ils un ATS ?",
        answer: "Non, les petites structures (< 10 salariés) gèrent souvent les candidatures par email. Mais les startups Series A+ et les ETI/grandes entreprises utilisent quasi-systématiquement un ATS.",
      },
      {
        id: 2,
        question: "Un CV Canva passe-t-il dans un ATS ?",
        answer: "Rarement bien. Les designs Canva avec colonnes, icônes et blocs graphiques sont souvent mal parsés. Pour les candidatures via ATS, préférez un CV Word ou PDF simple.",
      },
      {
        id: 3,
        question: "Peut-on voir son score ATS avant d'envoyer ?",
        answer: "Certains outils comme Jobscan permettent de comparer votre CV à une offre et d'estimer votre score ATS. Hirly fait cette analyse automatiquement et adapte le CV en conséquence.",
      },
      {
        id: 4,
        question: "L'ATS lit-il la lettre de motivation ?",
        answer: "L'ATS l'indexe mais c'est principalement le recruteur humain qui la lit. Ce qui compte pour l'ATS, c'est le CV. La LM compte pour convaincre le recruteur après le filtre automatique.",
      },
      {
        id: 5,
        question: "Hirly fonctionne-t-il avec Workday et Ashby ?",
        answer: "Hirly est actuellement intégré avec Greenhouse et Lever. La compatibilité Workday et Ashby est en cours de développement.",
      },
    ],
  },

  {
    slug: "job-matching-app",
    title: "Job matching : qu'est-ce que c'est et pourquoi c'est l'avenir de la recherche d'emploi",
    metaTitle: "Job matching : définition, fonctionnement et meilleures apps",
    metaDescription: "Le job matching par IA change la recherche d'emploi : définition, comment ça fonctionne, différence avec les jobboards classiques, et meilleures apps en 2026.",
    category: "Tendances",
    readTime: "6 min",
    date: "2026-07-03",
    intro: "Poster son CV sur un jobboard et attendre n'est plus une stratégie efficace. Le job matching est une approche différente : plutôt que de chercher, vous être trouvé — ou plutôt, l'algorithme trouve pour vous les offres qui correspondent exactement à votre profil. Voici ce que c'est, comment ça fonctionne, et pourquoi ça change fondamentalement la façon dont on cherche un emploi.",
    ctaMid: { text: "Essayer le matching IA de Hirly", href: "https://hirly.app" },
    ctaEnd: { text: "Trouvez vos prochaines offres avec Hirly", href: "https://hirly.app" },
    sections: [
      {
        h2: "Définition du job matching",
        body: [
          "Le job matching est un processus qui consiste à mettre en correspondance automatiquement un profil de candidat (compétences, expérience, préférences) avec des offres d'emploi, selon des critères de compatibilité précis. Le résultat est un score de matching : plus il est élevé, plus l'offre est pertinente pour vous.",
          "Contrairement à une recherche par mots-clés classique, le matching IA analyse le contexte — pas juste la présence d'un titre ou d'un outil dans votre CV, mais la profondeur de votre expérience sur ce sujet.",
        ],
      },
      {
        h2: "Comment fonctionne un algorithme de job matching",
        body: [
          "Les algorithmes de matching combinent plusieurs types d'analyse :",
        ],
        list: [
          "NLP (traitement du langage naturel) : comparaison sémantique CV / offre",
          "Analyse des compétences explicites (langages, outils, certifications)",
          "Préférences déclarées (remote, localisation, salaire, secteur)",
          "Comportement implicite (offres swipées à droite vs gauche, temps passé sur une fiche)",
          "Historique des candidatures (pour affiner les recommandations)",
        ],
      },
      {
        h2: "Jobboard classique vs job matching : quelle différence ?",
        body: [
          "Sur un jobboard classique (Indeed, Monster), vous entrez un mot-clé et obtenez une liste triée par date ou pertinence basique. C'est vous qui filtrez, vous qui adapatez, vous qui postulez.",
          "Avec une app de job matching comme Hirly, le processus s'inverse : l'algorithme présente des offres pré-filtrées selon votre profil avec un score de correspondance, et l'application génère et soumet votre candidature automatiquement quand vous swipez à droite.",
        ],
        list: [
          "Jobboard : vous cherchez → vous filtrez → vous postulez manuellement",
          "Job matching : l'algorithme propose → vous validez → l'app postule automatiquement",
        ],
      },
      {
        h2: "Les avantages concrets du job matching pour les candidats",
        body: [
          "Le matching IA réduit considérablement le temps passé sur des offres non pertinentes et améliore la qualité des candidatures soumises.",
        ],
        list: [
          "Gain de temps : 80 % de moins de temps passé à chercher des offres",
          "Pertinence : les offres proposées correspondent vraiment à votre profil",
          "Qualité des candidatures : CV et LM adaptés à chaque offre automatiquement",
          "Réduction du biais : l'algorithme ne juge pas la photo ou le nom",
          "Découverte : des offres que vous n'auriez pas trouvées en cherchant vous-même",
        ],
      },
      {
        h2: "Le swipe comme interface de matching — pourquoi ça fonctionne",
        body: [
          "Hirly utilise une interface swipe (à gauche = pas intéressé, à droite = je postule) pour plusieurs raisons. D'abord, c'est rapide — une décision en 2 à 5 secondes. Ensuite, c'est un signal comportemental riche : chaque swipe apprend à l'algorithme ce que vous recherchez vraiment, pas juste ce que vous avez déclaré.",
          "C'est la même logique que les apps de rencontre ou de streaming : votre comportement réel est plus informatif que vos préférences déclarées.",
        ],
      },
      {
        h2: "Les limites du job matching — ce qu'il faut savoir",
        body: [
          "Le matching IA n'est pas parfait. Il peut proposer des offres sur-qualifiées ou sous-qualifiées si votre profil est atypique. Et il dépend de la qualité des données disponibles — si les offres sont mal rédigées ou si votre CV est incomplet, les scores sont moins fiables.",
          "La bonne approche : utiliser le matching comme un premier filtre, pas comme une décision automatique. Vous gardez le contrôle sur chaque candidature envoyée.",
        ],
      },
    ],
    faq: [
      {
        id: 1,
        question: "Le job matching remplace-t-il LinkedIn ?",
        answer: "Non, ils sont complémentaires. LinkedIn est une plateforme de réseau et de visibilité passive. Le job matching est un outil de recherche active et d'automatisation. La combinaison des deux est souvent la plus efficace.",
      },
      {
        id: 2,
        question: "Le matching IA respecte-t-il la confidentialité des données ?",
        answer: "Les apps sérieuses comme Hirly stockent les données de profil de façon sécurisée et ne les revendent pas à des tiers. Les candidatures sont soumises en votre nom via les API officielles des ATS.",
      },
      {
        id: 3,
        question: "Comment améliorer son score de matching ?",
        answer: "Un profil complet (compétences, expériences détaillées, préférences claires) donne de meilleurs résultats. Swiper régulièrement affine aussi l'algorithme.",
      },
      {
        id: 4,
        question: "Le job matching fonctionne-t-il pour tous les secteurs ?",
        answer: "Les apps de matching actuelles sont plus efficaces dans la tech, le digital et les startups. La couverture des secteurs traditionnels (industrie, commerce, santé) est variable selon l'outil.",
      },
    ],
  },

  {
    slug: "tinder-emploi-app",
    title: "Tinder pour l'emploi : mythe ou réalité en 2026 ?",
    metaTitle: "Tinder pour l'emploi : mythe ou réalité en 2026 ?",
    metaDescription: "L'idée d'un Tinder pour l'emploi fait son chemin. En 2026, des apps comme Hirly rendent ce concept réel : matching IA, swipe, candidature automatique en 1 tap.",
    category: "Tendances",
    readTime: "5 min",
    date: "2026-07-03",
    intro: "L'idée circule depuis des années dans la tech : et si trouver un emploi était aussi simple que matcher sur Tinder ? En 2026, ce n'est plus un concept — c'est une réalité. Des apps comme Hirly ont rendu le swipe pour l'emploi opérationnel, avec une couche IA qui personnalise les candidatures automatiquement. Voici ce que ça change vraiment.",
    ctaMid: { text: "Swiper tes premières offres sur Hirly", href: "https://hirly.app" },
    ctaEnd: { text: "Essayer l'app maintenant", href: "https://hirly.app" },
    sections: [
      {
        h2: "L'idée originale : appliquer la logique Tinder au recrutement",
        body: [
          "Tinder a révolutionné les rencontres en simplifiant la décision à une seule action : swipe à gauche ou à droite. L'idée de transposer cette mécanique au recrutement est naturelle : un candidat voit une fiche de poste, swipe à droite s'il est intéressé, et si le recruteur swipe aussi à droite = match.",
          "Le problème de la première génération d'apps 'Tinder de l'emploi' (Jobr, Switch, etc.) : elles n'allaient pas assez loin. Le swipe n'était qu'une interface — la candidature restait manuelle derrière. Ce n'était pas assez différent d'un jobboard classique.",
        ],
      },
      {
        h2: "Ce qui a changé avec l'IA en 2024–2026",
        body: [
          "La vraie rupture n'est pas le swipe en lui-même — c'est ce qui se passe après. Avec les LLM modernes (GPT-4 class), il est possible de générer une candidature personnalisée et pertinente pour chaque offre en quelques secondes.",
          "Hirly combine les deux : l'interface swipe pour la décision rapide, et l'IA pour générer et soumettre la candidature automatiquement. Swiper à droite = votre dossier complet (CV adapté + LM) est envoyé à l'ATS du recruteur sans que vous ayez à lever le petit doigt.",
        ],
        list: [
          "Génération automatique du CV adapté à l'offre",
          "Génération de la lettre de motivation personnalisée",
          "Soumission directe à l'ATS (Greenhouse, Lever) via API officielle",
          "Tracking de la candidature en temps réel",
        ],
      },
      {
        h2: "Le matching bilateral — est-ce que les employeurs swipent aussi ?",
        body: [
          "Dans la logique Tinder originale, les deux parties doivent matcher. Dans le recrutement, ce modèle bilatéral est plus complexe : les recruteurs travaillent avec des ATS, pas avec des apps grand public.",
          "Le matching côté employeur se fait de façon asymétrique : l'algorithme de Hirly présente les offres aux candidats selon un score de compatibilité, pendant que le recruteur reçoit des candidatures via son ATS habituel. Ce n'est pas un double swipe, mais le résultat est similaire : le bon profil arrive sur la bonne offre.",
        ],
      },
      {
        h2: "Hirly vs les autres apps de 'swipe emploi'",
        body: [
          "Plusieurs apps ont essayé le concept avant Hirly. La différence principale est l'intégration complète du workflow : de la découverte de l'offre à la soumission ATS, tout se passe dans l'app sans friction.",
        ],
        list: [
          "Jobr (fermé) : swipe mais candidature manuelle",
          "Switch (limité) : matching mais pas d'auto-candidature",
          "Hirly : swipe + IA + auto-candidature ATS en 1 tap",
        ],
      },
      {
        h2: "Pour qui cette approche est-elle adaptée ?",
        body: [
          "Le modèle swipe + auto-candidature est particulièrement adapté à certains profils :",
        ],
        list: [
          "Candidats actifs qui veulent postuler à volume sans perdre en qualité",
          "Profils tech (dev, data, product, design) où les offres ATS sont dominantes",
          "Reconversions où l'on ne sait pas exactement ce qu'on cherche au départ",
          "Candidats passifs qui veulent rester ouverts sans effort actif",
        ],
      },
    ],
    faq: [
      {
        id: 1,
        question: "Hirly est-il vraiment comme Tinder mais pour l'emploi ?",
        answer: "L'interface swipe est similaire, mais ce qui se passe après est très différent : Hirly génère et soumet une candidature personnalisée pour chaque swipe à droite, ce que Tinder ne fait évidemment pas pour les rencontres.",
      },
      {
        id: 2,
        question: "Les recruteurs voient-ils qu'une app a postulé à leur place ?",
        answer: "Non. La candidature arrive dans l'ATS exactement comme une candidature manuelle. Rien n'indique qu'un outil a été utilisé.",
      },
      {
        id: 3,
        question: "Peut-on contrôler les candidatures avant qu'elles soient envoyées ?",
        answer: "Oui, Hirly propose un mode prévisualisation pour voir le CV et la LM générés avant envoi. Vous pouvez modifier ou annuler avant la soumission.",
      },
      {
        id: 4,
        question: "Cette approche fonctionne-t-elle pour les postes non-tech ?",
        answer: "Pour l'instant, Hirly est surtout optimisé pour les secteurs tech, startup et SaaS où Greenhouse et Lever sont dominants. Les secteurs non-tech sont moins bien couverts.",
      },
    ],
  },
];

export function getPostBySlug(slug) {
  return blogPosts.find((p) => p.slug === slug) ?? null;
}
