export function getLandingHeroDemoJobs(lang) {
  if (lang === "fr") {
    return [
      {
        id: "google",
        company: "Google",
        title: "Software Engineer Intern",
        matchScore: 98,
        location: "Paris",
        workModel: "Hybride",
        salary: "2 100 €/mois",
        contract: "Alternance",
        department: "Chrome & Web Platform",
        experience: "Bac+4 / Bac+5",
        postedLabel: "Publié il y a 2 jours",
        skills: ["React", "TypeScript", "Node.js", "Git"],
        summary:
          "Intégrez une équipe produit qui conçoit des expériences web utilisées par des millions d'utilisateurs en Europe.",
        reasons: [
          "Votre expérience en React et TypeScript correspond parfaitement aux missions du poste.",
          "Votre profil en informatique est exactement ce que l'équipe recherche pour cette alternance.",
          "L'entreprise propose du télétravail hybride, en ligne avec vos préférences.",
          "Vos projets personnels montrent une bonne maîtrise des APIs et du travail en équipe.",
          "Le rythme d'alternance (3 semaines entreprise / 1 semaine école) vous convient.",
        ],
        swipe: "skip",
      },
      {
        id: "lvmh",
        company: "LVMH",
        title: "Data Analyst",
        matchScore: 96,
        location: "Paris 8e",
        workModel: "Sur site",
        salary: "1 900 €/mois",
        contract: "Alternance",
        department: "Métiers du Luxe · BI",
        experience: "Bac+3 minimum",
        postedLabel: "Publié il y a 5 jours",
        skills: ["Python", "SQL", "Excel", "Power BI"],
        summary:
          "Analysez les performances commerciales des maisons du groupe et produisez des tableaux de bord pour les équipes métiers.",
        reasons: [
          "Vos compétences en Python et SQL correspondent aux outils utilisés au quotidien.",
          "Votre profil analytique colle aux missions de reporting et de visualisation.",
          "Votre CV a été optimisé pour cette offre par l'IA Hirly.",
          "Votre intérêt pour le retail et le luxe ressort clairement dans votre parcours.",
          "Vous êtes disponible pour une alternance de 12 mois renouvelable.",
        ],
        swipe: "apply",
      },
      {
        id: "airbus",
        company: "Airbus",
        title: "Ingénieur Logiciel",
        matchScore: 97,
        location: "Toulouse",
        workModel: "Présentiel",
        salary: "2 000 €/mois",
        contract: "Alternance",
        department: "Systèmes embarqués",
        experience: "Bac+5",
        postedLabel: "Publié cette semaine",
        skills: ["C++", "Python", "Git", "Linux"],
        summary:
          "Participez au développement de logiciels critiques pour les programmes civils et défense d'Airbus.",
        reasons: [
          "Votre formation en informatique correspond aux prérequis du poste.",
          "Vous maîtrisez Git, Python et C++, mentionnés dans l'offre.",
          "Votre lettre de motivation a été personnalisée pour ce poste.",
          "Votre niveau d'anglais technique est adapté à un environnement international.",
          "Vous êtes mobile sur le site de Toulouse pour la durée de l'alternance.",
        ],
        swipe: "skip",
      },
    ];
  }

  return [
    {
      id: "google",
      company: "Google",
      title: "Software Engineer Intern",
      matchScore: 98,
      location: "Paris",
      workModel: "Hybrid",
      salary: "€2,100 / month",
      contract: "Apprenticeship",
      department: "Chrome & Web Platform",
      experience: "Master's level",
      postedLabel: "Posted 2 days ago",
      skills: ["React", "TypeScript", "Node.js", "Git"],
      summary:
        "Join a product team building web experiences used by millions of users across Europe.",
      reasons: [
        "Your React and TypeScript experience is a strong match for the role.",
        "Your computer science profile fits what the team is hiring for.",
        "The company offers hybrid work that matches your preference.",
        "Your side projects show solid API and teamwork skills.",
        "The apprenticeship rhythm (3 weeks on-site / 1 week school) works for you.",
      ],
      swipe: "skip",
    },
    {
      id: "lvmh",
      company: "LVMH",
      title: "Data Analyst",
      matchScore: 96,
      location: "Paris",
      workModel: "On-site",
      salary: "€1,900 / month",
      contract: "Apprenticeship",
      department: "Luxury Brands · BI",
      experience: "Bachelor's minimum",
      postedLabel: "Posted 5 days ago",
      skills: ["Python", "SQL", "Excel", "Power BI"],
      summary:
        "Analyze commercial performance for group brands and build dashboards for business teams.",
      reasons: [
        "Your Python and SQL skills match the tools used day to day.",
        "Your analytical profile aligns with reporting and visualization work.",
        "Your resume was AI-optimized for this posting by Hirly.",
        "Your interest in retail and luxury shows clearly in your background.",
        "You're available for a 12-month renewable apprenticeship.",
      ],
      swipe: "apply",
    },
    {
      id: "airbus",
      company: "Airbus",
      title: "Software Engineer",
      matchScore: 97,
      location: "Toulouse",
      workModel: "On-site",
      salary: "€2,000 / month",
      contract: "Apprenticeship",
      department: "Embedded systems",
      experience: "Master's level",
      postedLabel: "Posted this week",
      skills: ["C++", "Python", "Git", "Linux"],
      summary:
        "Contribute to mission-critical software for Airbus civil and defense programs.",
      reasons: [
        "Your computer science background meets the role requirements.",
        "You master Git, Python, and C++, all listed in the posting.",
        "Your cover letter was personalized for this role.",
        "Your technical English level fits an international environment.",
        "You can work on-site in Toulouse for the full apprenticeship.",
      ],
      swipe: "skip",
    },
  ];
}

export function getLandingHeroApplySteps(lang) {
  if (lang === "fr") {
    return [
      {
        id: "read",
        label: "Analyse de l'offre",
        status: "Analyse de l'offre…",
        hint: "Hirly identifie les points clés du poste.",
      },
      {
        id: "resume",
        label: "Adaptation de votre CV",
        status: "Adaptation du CV…",
        hint: "Votre CV est ajusté pour cette offre.",
      },
      {
        id: "cover",
        label: "Rédaction de la lettre de motivation",
        status: "Rédaction de la lettre…",
        hint: "Une lettre personnalisée est générée pour vous.",
      },
      {
        id: "email",
        label: "Préparation de l'email de candidature",
        status: "Préparation de l'email…",
        hint: "CV et lettre sont joints automatiquement.",
      },
      {
        id: "submit",
        label: "Envoi de la candidature",
        status: "Envoi de la candidature…",
        hint: "Hirly envoie tout sur le site de l'entreprise.",
      },
    ];
  }
  return [
    {
      id: "read",
      label: "Reading job details",
      status: "Reading job details…",
      hint: "Hirly picks out what matters in the posting.",
    },
    {
      id: "resume",
      label: "Tailoring your resume",
      status: "Tailoring your resume…",
      hint: "Your resume is tuned for this role.",
    },
    {
      id: "cover",
      label: "Writing your cover letter",
      status: "Writing your cover letter…",
      hint: "A personalized letter is drafted for you.",
    },
    {
      id: "email",
      label: "Drafting application email",
      status: "Drafting your application email…",
      hint: "Resume and letter are attached automatically.",
    },
    {
      id: "submit",
      label: "Submitting your application",
      status: "Submitting your application…",
      hint: "Hirly submits everything on the company site.",
    },
  ];
}
