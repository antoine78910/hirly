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

const LOCALE_PATH_PREFIXES = new Set(["fr", "en"]);

export const CONTRACT_SLUG_BY_KEY = {
  permanent: "cdi",
  fixed_term: "cdd",
  internship: "stage",
  apprenticeship: "alternance",
  summer_job: "job-ete",
};

/** Hero highlight rotation order on the default landing (no /stage, /cdi, etc.). */
export const LANDING_HERO_ROTATION_KEYS = [
  "internship",
  "apprenticeship",
  "default",
  "permanent",
  "fixed_term",
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
};

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
  const locale = lang === "fr" ? "fr" : "en";
  const labels = HERO_JOB_LABELS[locale];
  const resolved = contractType && labels[contractType]
    ? contractType
    : resolveLandingContractType(contractType);
  if (resolved && labels[resolved]) return labels[resolved];
  return labels.default;
}

export function getLandingHeroRotatingLabels(lang) {
  return LANDING_HERO_ROTATION_KEYS
    .map((key, index) => ({
      label: getLandingHeroJobLabel(lang, key),
      index,
    }))
    .sort((a, b) => a.label.length - b.label.length || a.index - b.index)
    .map((item) => item.label);
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
  if (lang === "fr") {
    return {
      line1Prefix: "Trouve ton ",
      line2: "sans passer des heures",
      line3Prefix: "à ",
      accent: "postuler.",
    };
  }
  return {
    line1Prefix: "Find your ",
    line2: "without spending hours",
    line3Prefix: "",
    accent: "applying.",
  };
}

export function getLandingHeroCta(lang, contractType) {
  const jobLabel = getLandingHeroJobLabel(lang, contractType);
  if (lang === "fr") return `Trouve ton ${jobLabel} maintenant`;
  return `Find your ${jobLabel} now`;
}

export function getLandingHeroSubtitle(lang) {
  if (lang === "fr") {
    return "L'IA s'occupe de la recherche d'offres, du CV, de la lettre de motivation et des candidatures. Toi, tu n'as qu'à swiper.";
  }
  return "AI handles job search, your CV, cover letters, and applications. All you have to do is swipe.";
}

export function getLandingHeroBullets(lang) {
  if (lang === "fr") {
    return [
      "Postule jusqu'à 10× plus vite.",
      "Plus de 100 000 offres d'emploi.",
    ];
  }
  return [
    "Apply up to 10× faster.",
    "Over 100,000 job listings.",
  ];
}
