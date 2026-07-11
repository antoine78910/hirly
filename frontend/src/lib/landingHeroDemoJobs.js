const REMOTE_BY_WORK_MODEL = {
  Hybride: "hybrid",
  Hybrid: "hybrid",
  "Sur site": "on_site",
  "On-site": "on_site",
  Présentiel: "on_site",
};

function enrichLandingDemoJob(job) {
  return {
    job_id: job.id,
    ...job,
    match_score: job.matchScore,
    salary_label: job.salary,
    contract_type: job.contract,
    employment_type: job.contract,
    remote: REMOTE_BY_WORK_MODEL[job.workModel] || job.workModel,
    education_level: job.experience,
    industry: job.department,
    clean_description: job.summary,
    offer_details: [
      { key: "contract_type", value: job.contract },
      { key: "work_schedule", value: job.workModel },
      { key: "experience", value: job.experience },
      ...(job.benefits ? [{ key: "benefits", value: job.benefits }] : []),
      ...(job.workContext ? [{ key: "work_context", value: job.workContext }] : []),
    ],
  };
}

export function getLandingHeroDemoJobs(lang) {
  const jobs = lang === "fr" ? FRENCH_JOBS : ENGLISH_JOBS;
  return jobs.map(enrichLandingDemoJob);
}

const FRENCH_JOBS = [
  {
    id: "google",
    company: "Google",
    title: "Software Engineer Intern",
    matchScore: 98,
    location: "Paris",
    workModel: "Hybride",
    salary: "2 100 €/mois",
    contract: "Alternance",
    department: "Tech · Chrome & Web Platform",
    experience: "Bac+4 / Bac+5",
    postedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    benefits: "Tickets restaurant · Mutuelle · RTT",
    workContext: "Équipe produit web, 40 personnes à Paris",
    skills: ["React", "TypeScript", "Node.js", "Git"],
    summary:
      "Intégrez une équipe produit qui conçoit des expériences web utilisées par des millions d'utilisateurs en Europe.",
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
    department: "Luxe · Business Intelligence",
    experience: "Bac+3 minimum",
    postedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    benefits: "Tickets restaurant · Transport · Mutuelle",
    workContext: "Direction data au sein du groupe LVMH",
    skills: ["Python", "SQL", "Excel", "Power BI"],
    summary:
      "Analysez les performances commerciales des maisons du groupe et produisez des tableaux de bord pour les équipes métiers.",
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
    department: "Aéronautique · Systèmes embarqués",
    experience: "Bac+5",
    postedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    benefits: "Tickets restaurant · Mutuelle · Télétravail occasionnel",
    workContext: "Programmes civils et défense, site de Toulouse",
    skills: ["C++", "Python", "Git", "Linux"],
    summary:
      "Participez au développement de logiciels critiques pour les programmes civils et défense d'Airbus.",
    swipe: "skip",
  },
];

const ENGLISH_JOBS = [
  {
    id: "google",
    company: "Google",
    title: "Software Engineer Intern",
    matchScore: 98,
    location: "Paris",
    workModel: "Hybrid",
    salary: "€2,100 / month",
    contract: "Apprenticeship",
    department: "Tech · Chrome & Web Platform",
    experience: "Master's level",
    postedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    benefits: "Meal vouchers · Health insurance · RTT",
    workContext: "Web product team, 40 people in Paris",
    skills: ["React", "TypeScript", "Node.js", "Git"],
    summary:
      "Join a product team building web experiences used by millions of users across Europe.",
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
    department: "Luxury · Business Intelligence",
    experience: "Bachelor's minimum",
    postedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    benefits: "Meal vouchers · Transport · Health insurance",
    workContext: "Group data team within LVMH headquarters",
    skills: ["Python", "SQL", "Excel", "Power BI"],
    summary:
      "Analyze commercial performance for group brands and build dashboards for business teams.",
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
    department: "Aerospace · Embedded systems",
    experience: "Master's level",
    postedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    benefits: "Meal vouchers · Health insurance · Occasional remote",
    workContext: "Civil and defense programs, Toulouse site",
    skills: ["C++", "Python", "Git", "Linux"],
    summary:
      "Contribute to mission-critical software for Airbus civil and defense programs.",
    swipe: "skip",
  },
];

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
