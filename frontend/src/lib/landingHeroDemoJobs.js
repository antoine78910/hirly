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
        reasons: [
          "Votre expérience en React et TypeScript correspond parfaitement.",
          "Votre profil en informatique est recherché pour ce poste.",
          "L'entreprise propose du télétravail selon votre préférence.",
        ],
        swipe: "skip",
      },
      {
        id: "lvmh",
        company: "LVMH",
        title: "Data Analyst",
        matchScore: 96,
        location: "Paris",
        workModel: null,
        salary: "1 900 €/mois",
        contract: "Alternance",
        reasons: [
          "Vos compétences en Python et SQL correspondent au poste.",
          "Votre profil analytique est en adéquation avec les missions.",
          "Votre CV a été optimisé pour cette offre par l'IA.",
        ],
        swipe: "apply",
      },
      {
        id: "airbus",
        company: "Airbus",
        title: "Ingénieur Logiciel",
        matchScore: 97,
        location: "Toulouse",
        workModel: null,
        salary: "2 000 €/mois",
        contract: "Alternance",
        reasons: [
          "Votre formation en informatique correspond aux prérequis.",
          "Vous maîtrisez Git, Python et C++.",
          "Votre lettre de motivation a été personnalisée pour ce poste.",
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
      reasons: [
        "Your React and TypeScript experience is a strong match.",
        "Your computer science profile fits this role.",
        "The company offers hybrid work that matches your preference.",
      ],
      swipe: "skip",
    },
    {
      id: "lvmh",
      company: "LVMH",
      title: "Data Analyst",
      matchScore: 96,
      location: "Paris",
      workModel: null,
      salary: "€1,900 / month",
      contract: "Apprenticeship",
      reasons: [
        "Your Python and SQL skills match the role.",
        "Your analytical profile aligns with the missions.",
        "Your resume was AI-optimized for this posting.",
      ],
      swipe: "apply",
    },
    {
      id: "airbus",
      company: "Airbus",
      title: "Software Engineer",
      matchScore: 97,
      location: "Toulouse",
      workModel: null,
      salary: "€2,000 / month",
      contract: "Apprenticeship",
      reasons: [
        "Your computer science background meets the requirements.",
        "You master Git, Python, and C++.",
        "Your cover letter was personalized for this role.",
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
