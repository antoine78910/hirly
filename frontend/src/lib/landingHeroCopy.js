const CONTRACT_ALIASES = {
  permanent: "permanent",
  cdi: "permanent",
  "full-time": "permanent",
  full_time: "permanent",
  fixed_term: "fixed_term",
  cdd: "fixed_term",
  "fixed-term": "fixed_term",
  internship: "internship",
  stage: "internship",
  stagiaire: "internship",
  apprenticeship: "apprenticeship",
  alternance: "apprenticeship",
  apprentissage: "apprenticeship",
  summer_job: "summer_job",
  "summer-job": "summer_job",
  "job-ete": "summer_job",
  job_ete: "summer_job",
  "job d'ete": "summer_job",
  "job d'été": "summer_job",
};

/** Public URL slugs for campaign landing pages (e.g. /stage, /alternance). */
export const LANDING_CONTRACT_PATH_SLUGS = [
  "cdi",
  "cdd",
  "stage",
  "alternance",
  "job-ete",
  "job-d-ete",
  "summer-job",
];

const LOCALE_PATH_PREFIXES = new Set(["fr", "en", "de", "es", "it"]);

export const CONTRACT_SLUG_BY_KEY = {
  permanent: "cdi",
  fixed_term: "cdd",
  internship: "stage",
  apprenticeship: "alternance",
  summer_job: "job-ete",
};

/** Hero highlight rotation order on the default landing (no /stage, /cdi, etc.). */
export const LANDING_HERO_ROTATION_KEYS = [
  "default",
  "permanent",
  "fixed_term",
  "internship",
  "apprenticeship",
  "summer_job",
  "seasonal_job",
];

const HERO_JOB_LABELS = {
  fr: {
    permanent: "CDI",
    fixed_term: "CDD",
    internship: "stage",
    apprenticeship: "alternance",
    summer_job: "job d'été",
    seasonal_job: "saisonnier",
    default: "emploi",
  },
  en: {
    permanent: "full-time job",
    fixed_term: "fixed-term contract",
    internship: "internship",
    apprenticeship: "apprenticeship",
    summer_job: "summer job",
    seasonal_job: "seasonal job",
    default: "job",
  },
  de: {
    permanent: "deinen Vollzeitjob",
    fixed_term: "einen befristeten Job",
    internship: "ein Praktikum",
    apprenticeship: "eine Ausbildung",
    summer_job: "einen Sommerjob",
    seasonal_job: "einen Saisonjob",
    default: "einen Job",
  },
  es: {
    permanent: "empleo a tiempo completo",
    fixed_term: "contrato temporal",
    internship: "plaza de prácticas",
    apprenticeship: "formación dual",
    summer_job: "empleo de verano",
    seasonal_job: "empleo de temporada",
    default: "empleo",
  },
  it: {
    permanent: "lavoro a tempo indeterminato",
    fixed_term: "contratto a tempo determinato",
    internship: "tirocinio",
    apprenticeship: "apprendistato",
    summer_job: "lavoro estivo",
    seasonal_job: "lavoro stagionale",
    default: "lavoro",
  },
};

const LANDING_HERO_COPY = {
  fr: {
    headline: {
      line1Prefix: "Trouve ton ",
      line2: "sans passer des heures",
      line3Prefix: "à ",
      accent: "postuler.",
    },
    cta: (jobLabel) => `Trouve ton ${jobLabel} maintenant`,
    subtitle: "L'IA s'occupe de la recherche d'offres, du CV, de la lettre de motivation et des candidatures. Toi, tu n'as qu'à swiper.",
    bullets: [
      "Postule jusqu'à 10× plus vite.",
      "Plus de 500 000 offres d'emploi.",
    ],
  },
  en: {
    headline: {
      line1Prefix: "Find your ",
      line2: "without spending hours",
      line3Prefix: "",
      accent: "applying.",
    },
    cta: (jobLabel) => `Find your ${jobLabel} now`,
    subtitle: "AI handles job search, your CV, cover letters, and applications. All you have to do is swipe.",
    bullets: ["Apply up to 10× faster.", "Over 500,000 job listings."],
  },
  de: {
    headline: {
      line1Prefix: "Finde ",
      line2: "ohne Stunden damit zu verbringen,",
      line3Prefix: "",
      accent: "Bewerbungen zu schreiben.",
    },
    cta: (jobLabel) => `Finde jetzt ${jobLabel}`,
    subtitle: "KI übernimmt die Jobsuche, deinen Lebenslauf, Anschreiben und Bewerbungen. Du musst nur swipen.",
    bullets: [
      "Bewirb dich bis zu 10× schneller.",
      "Über 500.000 Stellenangebote.",
    ],
  },
  es: {
    headline: {
      line1Prefix: "Encuentra tu ",
      line2: "sin pasar horas",
      line3Prefix: "",
      accent: "enviando solicitudes.",
    },
    cta: (jobLabel) => `Encuentra tu ${jobLabel} ahora`,
    subtitle: "La IA se encarga de buscar empleo, tu CV, las cartas de presentación y las solicitudes. Tú solo tienes que deslizar.",
    bullets: [
      "Solicita empleos hasta 10× más rápido.",
      "Más de 500.000 ofertas de empleo.",
    ],
  },
  it: {
    headline: {
      line1Prefix: "Trova il tuo ",
      line2: "senza passare ore",
      line3Prefix: "a ",
      accent: "candidarti.",
    },
    cta: (jobLabel) => `Trova il tuo ${jobLabel} ora`,
    subtitle: "L'IA si occupa della ricerca di lavoro, del CV, delle lettere di presentazione e delle candidature. Tu devi solo scorrere.",
    bullets: [
      "Candidati fino a 10× più velocemente.",
      "Oltre 500.000 offerte di lavoro.",
    ],
  },
};

function resolveLandingLocale(lang) {
  const locale = String(lang || "").trim().toLowerCase().split("-")[0];
  return LANDING_HERO_COPY[locale] ? locale : "en";
}

export function resolveLandingContractType(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!key) return null;
  return CONTRACT_ALIASES[key] || null;
}

export function resolveLandingContractFromLocation(pathname, searchParams) {
  const fromQuery =
    searchParams?.get("contract")
    || searchParams?.get("type")
    || searchParams?.get("job");
  if (fromQuery) return resolveLandingContractType(fromQuery);

  const segments = String(pathname || "")
    .split("/")
    .filter(Boolean);
  if (!segments.length) return null;

  let slug = segments[0];
  if (LOCALE_PATH_PREFIXES.has(slug) && segments[1]) {
    slug = segments[1];
  }
  return resolveLandingContractType(slug);
}

export function getLandingContractSlug(contractKey) {
  if (!contractKey) return null;
  return CONTRACT_SLUG_BY_KEY[contractKey] || null;
}

export function getLandingHeroJobLabel(lang, contractType) {
  const locale = resolveLandingLocale(lang);
  const labels = HERO_JOB_LABELS[locale];
  const resolved = contractType && labels[contractType]
    ? contractType
    : resolveLandingContractType(contractType);
  if (resolved && labels[resolved]) return labels[resolved];
  return labels.default;
}

export function getLandingHeroRotatingLabels(lang) {
  return LANDING_HERO_ROTATION_KEYS.map((key) => getLandingHeroJobLabel(lang, key));
}

/** Fixed slot width so the hero line does not jump between words. */
export function getLandingHeroHighlightWidthCh(lang) {
  const labels = [
    ...getLandingHeroRotatingLabels(lang),
    getLandingHeroJobLabel(lang, null),
  ];
  const maxLen = Math.max(...labels.map((label) => label.length), 3);
  return maxLen + 0.75;
}

export function getLandingHeroHeadline(lang, contractType) {
  return LANDING_HERO_COPY[resolveLandingLocale(lang)].headline;
}

export function getLandingHeroCta(lang, contractType) {
  const jobLabel = getLandingHeroJobLabel(lang, contractType);
  return LANDING_HERO_COPY[resolveLandingLocale(lang)].cta(jobLabel);
}

export function getLandingHeroSubtitle(lang) {
  return LANDING_HERO_COPY[resolveLandingLocale(lang)].subtitle;
}

export function getLandingHeroBullets(lang) {
  return LANDING_HERO_COPY[resolveLandingLocale(lang)].bullets;
}
