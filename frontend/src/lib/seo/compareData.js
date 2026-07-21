export const comparePages = [
  {
    slug: "hirly-vs-linkedin",
    title: "Hirly vs LinkedIn : lequel choisir pour trouver un emploi en 2026 ?",
    metaTitle: "Hirly vs LinkedIn : comparatif honnête pour les candidats 2026",
    metaDescription: "Hirly vs LinkedIn : forces, limites, différences clés. Lequel choisir pour une recherche d'emploi active en 2026 ? Comparatif honnête avec tableau de features.",
    competitor: "LinkedIn",
    hirlyTagline: "Matching IA + auto-candidature ATS en 1 swipe",
    competitorTagline: "Réseau professionnel #1, visibilité passive",
    verdict: "Hirly est meilleur pour postuler activement et rapidement. LinkedIn est meilleur pour la visibilité passive et le réseau. Les deux sont complémentaires.",
    features: [
      { feature: "Recherche d'offres", hirly: "Matching IA personnalisé", competitor: "Recherche par mots-clés" },
      { feature: "Candidature automatique", hirly: "Oui — 1 swipe suffit", competitor: "Non — formulaire manuel" },
      { feature: "Génération CV adapté", hirly: "Oui, par IA pour chaque offre", competitor: "Non" },
      { feature: "Lettre de motivation IA", hirly: "Oui, personnalisée à chaque offre", competitor: "Non" },
      { feature: "Soumission ATS directe", hirly: "Greenhouse, Lever", competitor: "Non — redirections externes" },
      { feature: "Suivi des candidatures", hirly: "Tracker intégré", competitor: "Basique (My Jobs)" },
      { feature: "Réseau professionnel", hirly: "Non", competitor: "Oui — référence mondiale" },
      { feature: "Visibilité passive", hirly: "Non", competitor: "Oui — les recruteurs vous trouvent" },
      { feature: "Volume d'offres", hirly: "Restreint (tech/startup)", competitor: "Très large (toutes catégories)" },
      { feature: "Prix candidat", hirly: "Gratuit + plans payants", competitor: "Gratuit + Premium €29/mois" },
    ],
    sections: [
      {
        h2: "LinkedIn — Le réseau avant tout",
        body: "LinkedIn reste la référence pour la visibilité professionnelle. Son modèle est celui du réseau passif : votre profil est visible des recruteurs, des chasseurs de têtes et des partenaires. Pour les profils seniors ou les freelances, c'est souvent la source principale d'opportunités entrantes. La recherche d'emploi active via LinkedIn reste manuelle : vous parcourez les offres, vous remplissez des formulaires, et vous gérez vous-même les relances.",
      },
      {
        h2: "Hirly — L'automatisation active",
        body: "Hirly prend le contre-pied : plutôt que d'attendre d'être trouvé, il optimise votre recherche active. L'IA analyse votre profil et propose des offres pertinentes avec un score de matching. Un swipe à droite génère automatiquement votre CV adapté, votre lettre de motivation, et soumet le tout directement dans l'ATS du recruteur. Vous postulez à 10 offres en 10 minutes.",
      },
      {
        h2: "Quand LinkedIn est le meilleur choix",
        body: "LinkedIn est le meilleur outil quand vous cherchez à être visible sans effort actif — typiquement les profils seniors avec 7+ ans d'expérience, les freelances qui cherchent des missions, ou les candidats dans des secteurs où le réseau compte plus que la candidature. Si vous recevez déjà des messages de recruteurs régulièrement, LinkedIn fait déjà le travail pour vous.",
      },
      {
        h2: "Quand Hirly est le meilleur choix",
        body: "Hirly est plus efficace quand vous cherchez activement un emploi dans la tech, les startups ou le SaaS, que vous êtes junior ou en reconversion (moins de visibilité passive), ou que vous voulez postuler à volume sans sacrifier la qualité des candidatures. Si vous passez plus d'une heure par jour à remplir des formulaires de candidature, Hirly vous fait économiser ce temps.",
      },
    ],
    faq: [
      { id: 1, question: "Peut-on utiliser Hirly et LinkedIn en même temps ?", answer: "Oui, et c'est la combinaison recommandée. LinkedIn pour la visibilité passive et le réseau, Hirly pour les candidatures actives automatisées." },
      { id: 2, question: "Hirly soumet-il aux offres LinkedIn ?", answer: "Hirly se concentre sur les offres accessibles via Greenhouse et Lever. Les offres uniquement sur LinkedIn (sans ATS externe) ne sont pas couvertes pour l'instant." },
      { id: 3, question: "LinkedIn Premium vaut-il la peine ?", answer: "LinkedIn Premium apporte principalement InMail et des insights sur les candidatures. Pour une recherche active, Hirly offre plus de valeur concrète au même prix." },
      { id: 4, question: "Les recruteurs préfèrent-ils les candidatures LinkedIn ou ATS ?", answer: "La plupart des entreprises tech gèrent les candidatures dans leur ATS, pas dans LinkedIn. La soumission directe via API ATS (Hirly) est souvent plus fiable qu'une candidature LinkedIn Easy Apply." },
    ],
  },
  {
    slug: "hirly-vs-indeed",
    title: "Hirly vs Indeed : comparatif honnête pour les candidats actifs",
    metaTitle: "Hirly vs Indeed : quel jobboard en 2026 ?",
    metaDescription: "Hirly vs Indeed : volume vs qualité, candidature manuelle vs automatique. Comparatif honnête pour choisir le bon outil selon votre profil et secteur.",
    competitor: "Indeed",
    hirlyTagline: "Matching IA + auto-candidature ATS en 1 swipe",
    competitorTagline: "Le plus grand agrégateur d'offres d'emploi mondial",
    verdict: "Indeed gagne sur le volume et la couverture sectorielle. Hirly gagne sur l'expérience candidat, la personnalisation et la vitesse de candidature. Pour la tech et les startups, Hirly est plus efficace.",
    features: [
      { feature: "Volume d'offres", hirly: "Restreint (tech/startup)", competitor: "Très large (toutes catégories)" },
      { feature: "Candidature automatique", hirly: "Oui — 1 swipe suffit", competitor: "Non — formulaire par offre" },
      { feature: "Génération CV adapté", hirly: "Oui, par IA", competitor: "Non" },
      { feature: "Lettre de motivation IA", hirly: "Oui, personnalisée", competitor: "Non" },
      { feature: "Soumission ATS directe", hirly: "Greenhouse, Lever", competitor: "Non — redirections externes" },
      { feature: "Indeed Apply", hirly: "Non applicable", competitor: "Oui (formulaire rapide)" },
      { feature: "Matching IA", hirly: "Score de matching par profil", competitor: "Correspondance basique par mots-clés" },
      { feature: "Alertes emploi", hirly: "Matching affiné par comportement", competitor: "Alertes email par mots-clés" },
      { feature: "Suivi candidatures", hirly: "Tracker intégré complet", competitor: "Basique" },
      { feature: "Prix candidat", hirly: "Gratuit + plans payants", competitor: "Gratuit" },
    ],
    sections: [
      {
        h2: "Indeed — Le volume, atout principal",
        body: "Indeed est l'agrégateur d'offres d'emploi le plus large au monde. Il référence les offres de milliers de sites, jobboards et pages carrière d'entreprises. Pour les candidats dans des secteurs non-tech (commerce, industrie, santé, logistique), Indeed est souvent la seule plateforme avec une couverture complète. 'Indeed Apply' permet de postuler rapidement dans certains cas, mais reste limité aux offres qui l'activent et n'adapte pas le CV.",
      },
      {
        h2: "Hirly — La qualité et la vitesse",
        body: "Hirly sacrifie le volume pour la qualité. Les offres proposées sont sélectionnées via un algorithme de matching basé sur votre profil complet. Et surtout, le workflow de candidature est entièrement automatisé : swiper à droite génère votre candidature personnalisée et la soumet directement à l'ATS. Pas de formulaire, pas de copy-paste, pas de perte de temps.",
      },
      {
        h2: "Quand Indeed est le meilleur choix",
        body: "Indeed est incontournable si vous cherchez dans des secteurs peu couverts par les ATS modernes (retail, restauration, industrie, santé, administration). C'est aussi le bon outil si vous cherchez dans des villes moyennes ou des zones géographiques précises où l'offre tech est limitée. Pour une première recherche tous secteurs confondus, Indeed donne une bonne vue du marché.",
      },
      {
        h2: "Quand Hirly est le meilleur choix",
        body: "Hirly est nettement supérieur si vous êtes dans la tech, le SaaS, le marketing digital ou le design, et que les entreprises que vous ciblez utilisent Greenhouse ou Lever. Le gain de temps est considérable : là où postuler à 10 offres sur Indeed prend 3h, Hirly le fait en 10 minutes avec des candidatures de meilleure qualité.",
      },
    ],
    faq: [
      { id: 1, question: "Indeed est-il meilleur qu'Hirly pour trouver un emploi ?", answer: "Ça dépend du secteur. Pour la tech et les startups, Hirly est plus efficace. Pour les secteurs traditionnels, Indeed a une meilleure couverture." },
      { id: 2, question: "Indeed Apply est-il aussi rapide que Hirly ?", answer: "Indeed Apply accélère le remplissage des formulaires mais ne génère pas de candidature personnalisée. Hirly adapte le CV et la LM à chaque offre automatiquement." },
      { id: 3, question: "Peut-on utiliser Hirly et Indeed ensemble ?", answer: "Oui. Indeed pour la veille et la couverture large, Hirly pour les candidatures actives automatisées dans la tech." },
      { id: 4, question: "Indeed donne-t-il des retours sur les candidatures ?", answer: "Indeed fournit des données basiques (nombre de vues). Le suivi détaillé des candidatures est limité. Hirly intègre un tracker complet avec historique et rappels." },
    ],
  },
];

export function getCompareBySlug(slug) {
  return comparePages.find((p) => p.slug === slug) ?? null;
}
