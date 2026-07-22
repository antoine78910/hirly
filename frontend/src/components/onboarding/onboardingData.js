import { formatSalary as formatSalaryEuro } from "../../lib/currency";
import {
  Baby,
  BarChart3,
  Brain,
  Briefcase,
  Building2,
  Check,
  Clock,
  Code2,
  Crown,
  Database,
  DollarSign,
  Gift,
  GraduationCap,
  Headphones,
  HeartPulse,
  HelpCircle,
  Laptop,
  Layers,
  Megaphone,
  Palette,
  Sun,
  Leaf,
  Rocket,
  Scale,
  Search,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  User,
  Users,
  Video,
  Wrench,
  X,
  Zap,
  FileCheck2,
  MessageSquare,
  MessageSquareX,
  ClipboardCopy,
  Hourglass,
  Send,
  Filter,
  RefreshCw,
  UserX,
  Puzzle,
  CircleDollarSign,
  ListChecks,
  FlaskConical,
  Calendar,
  TrendingDown,
  Table2,
  Repeat,
  EyeOff,
  Globe,
  Bell,
  Keyboard,
  FolderOpen,
  Copy,
  ScrollText,
  PenLine,
  BatteryLow,
  Infinity,
  MailWarning,
  Sheet,
  UtensilsCrossed,
  ShoppingBag,
  Package,
  Truck,
  Hammer,
  Scan,
  Umbrella,
  Home,
  ThumbsDown,
  Ban,
} from "lucide-react";

/** Hirly onboarding step order (aligned with Sprout flow + Hirly extras). */
export const ONBOARDING_STEP_ORDER = [
  "intro", // 5 illustrated intro slides
  "signup",
  "jobSearch",
  "jobGoal", // What's your goal? (early — before other goal-style questions)
  "compare2x", // 2× interviews vs on your own
  "contractType", // Hirly: CDI/CDD/etc.
  "otherApps", // Have you tried other job apps?
  "longTerm", // Long-term results chart
  "categories", // Job categories + roles
  "experience", // Experience level
  "location", // Where do you want to work?
  "contactPhone", // Phone — required by many employers to apply
  "salary", // Expected salary range
  "interviews", // Interviews per week
  "jobTimeline", // When do you need a new job?
  "interviewsConfirm", // Achievable interviews/week
  "jobBlocker", // What's stopping you?
  "jobAccomplish", // What do you want to accomplish?
  "potentialChart", // Interview rate potential
  "attribution", // How did you hear about us?
  "referralCode", // Referral / access code
  "upload", // Upload CV
  "profileSetup", // Setup loader
  "profileWelcome", // Personalized welcome cards
  "showcaseLanding",
  "showcaseAllInOne",
  "showcasePricing",
];

/** Dark setup loader — order: image 3 → 4 → 2 → 1 (user reference). */
export const PROFILE_SETUP_PHASES = [
  { sub: "Setting up everything…" },
  { sub: "Analyzing your profile…" },
  { sub: "Calibrating recommendations…" },
  { sub: "Finding the perfect opportunities for you…" },
];

export const PROFILE_SETUP_PHASES_FR = [
  { sub: "Tout préparer…" },
  { sub: "Analyse de votre profil…" },
  { sub: "Calibrage des recommandations…" },
  { sub: "Recherche des meilleures opportunités pour vous…" },
];

/** Personalized “Welcome” cards shown after CV upload, before phone mockup steps. */
const ONBOARDING_WELCOME_COPY = {
  fr: {
    primaryRole: "vos postes cibles",
    industryHint: "les meilleures entreprises",
    items: [
      {
        title: "Boostez votre carrière",
        body: ({ salaryLabel }) =>
          `Nous vous aiderons à cibler des équipes en pleine croissance et des postes alignés avec votre objectif de ${salaryLabel}+.`,
      },
      {
        title: "Candidatez à la vitesse de la lumière",
        body: ({ primaryRole }) =>
          `Notre agent IA automatise les candidatures pour ${primaryRole} — fini le copier-coller.`,
      },
      {
        title: "Décrochez votre prochaine victoire",
        body: ({ industryHint, interviewsPerWeek }) =>
          `Swipez sur les offres ${industryHint}. Nous gérons la paperasse pendant que vous visez ${interviewsPerWeek} entretiens par semaine.`,
      },
    ],
  },
  en: {
    primaryRole: "your target roles",
    industryHint: "top companies",
    items: [
      {
        title: "Scale Your Career Fast",
        body: ({ salaryLabel }) =>
          `We'll help you target high-growth teams and roles aligned with your ${salaryLabel}+ salary goal.`,
      },
      {
        title: "Apply at Light Speed",
        body: ({ primaryRole }) =>
          `Our AI agent automates tailored applications for ${primaryRole} — no more copy-pasting the same answers.`,
      },
      {
        title: "Land Your Next Win",
        body: ({ industryHint, interviewsPerWeek }) =>
          `Swipe right on ${industryHint} matches. We handle the paperwork while you focus on landing ${interviewsPerWeek} interviews per week.`,
      },
    ],
  },
  de: {
    primaryRole: "deine Zielpositionen",
    industryHint: "Top-Unternehmen",
    items: [
      {
        title: "Bring deine Karriere voran",
        body: ({ salaryLabel }) =>
          `Wir helfen dir, wachstumsstarke Teams und Positionen zu finden, die zu deinem Gehaltsziel von ${salaryLabel}+ passen.`,
      },
      {
        title: "Bewirb dich in Lichtgeschwindigkeit",
        body: ({ primaryRole }) =>
          `Unser KI-Agent automatisiert maßgeschneiderte Bewerbungen für ${primaryRole} — kein Copy-and-Paste mehr.`,
      },
      {
        title: "Sichere dir deinen nächsten Erfolg",
        body: ({ industryHint, interviewsPerWeek }) =>
          `Swipe durch passende Stellen bei ${industryHint}. Wir übernehmen den Papierkram, während du ${interviewsPerWeek} Vorstellungsgespräche pro Woche ansteuerst.`,
      },
    ],
  },
  es: {
    primaryRole: "tus puestos objetivo",
    industryHint: "las mejores empresas",
    items: [
      {
        title: "Impulsa tu carrera",
        body: ({ salaryLabel }) =>
          `Te ayudaremos a encontrar equipos en crecimiento y puestos acordes con tu objetivo salarial de ${salaryLabel}+.`,
      },
      {
        title: "Solicita empleo a toda velocidad",
        body: ({ primaryRole }) =>
          `Nuestro agente de IA automatiza las solicitudes personalizadas para ${primaryRole}; se acabó copiar y pegar las mismas respuestas.`,
      },
      {
        title: "Consigue tu próximo logro",
        body: ({ industryHint, interviewsPerWeek }) =>
          `Desliza entre ofertas de ${industryHint}. Nosotros nos ocupamos del papeleo mientras buscas conseguir ${interviewsPerWeek} entrevistas por semana.`,
      },
    ],
  },
  it: {
    primaryRole: "i tuoi ruoli ideali",
    industryHint: "le migliori aziende",
    items: [
      {
        title: "Fai crescere la tua carriera",
        body: ({ salaryLabel }) =>
          `Ti aiuteremo a puntare a team in crescita e ruoli in linea con il tuo obiettivo di stipendio di ${salaryLabel}+.`,
      },
      {
        title: "Candidati alla velocità della luce",
        body: ({ primaryRole }) =>
          `Il nostro agente IA automatizza le candidature su misura per ${primaryRole}: niente più copia e incolla.`,
      },
      {
        title: "Conquista il tuo prossimo traguardo",
        body: ({ industryHint, interviewsPerWeek }) =>
          `Scorri le offerte di ${industryHint}. Noi gestiamo la burocrazia mentre punti a ${interviewsPerWeek} colloqui a settimana.`,
      },
    ],
  },
};

function onboardingCopyLocale(lang) {
  const locale = typeof lang === "string" ? lang.toLowerCase().split("-")[0] : "";
  return ONBOARDING_WELCOME_COPY[locale] ? locale : "en";
}

export function buildProfileWelcomeItems({
  salaryMin,
  selectedRoles = [],
  categories = [],
  categoryOptions = [],
  interviewsPerWeek = 4,
  lang = "fr",
}) {
  const locale = onboardingCopyLocale(lang);
  const copy = ONBOARDING_WELCOME_COPY[locale];
  const salaryLabel = formatSalary(salaryMin, locale);
  const primaryRole = selectedRoles[0] || copy.primaryRole;
  const categoryLabels = categories
    .map((id) => categoryOptions.find((c) => c.id === id)?.label)
    .filter(Boolean);
  const industryHint = categoryLabels.length
    ? categoryLabels.slice(0, 2).join(" & ")
    : copy.industryHint;

  const values = { salaryLabel, primaryRole, industryHint, interviewsPerWeek };
  return copy.items.map(({ title, body }) => ({ title, body: body(values) }));
}

/** Hero tagline — final pricing showcase step only (once, in page content). */
export const ONBOARDING_VALUE_TAGLINE = {
  fr: "2× plus d'entretiens. 5× moins d'efforts.",
  en: "2× more interviews. 5× less effort.",
  de: "2× mehr Vorstellungsgespräche. 5× weniger Aufwand.",
  es: "2× más entrevistas. 5× menos esfuerzo.",
  it: "2× più colloqui. 5× meno impegno.",
};

export function getOnboardingValueTagline(lang = "fr") {
  return ONBOARDING_VALUE_TAGLINE[onboardingCopyLocale(lang)];
}

/** Steps from profile welcome through pricing (preview / dev shortcuts). */
export const ONBOARDING_LATE_STEP_IDS = [
  "profileSetup",
  "profileWelcome",
  "showcaseLanding",
  "showcaseAllInOne",
  "showcasePricing",
];

const ONBOARDING_PREVIEW_STEP_ALIASES = {
  final: "showcaseLanding",
  welcome: "profileWelcome",
  allinone: "showcaseAllInOne",
  pricing: "showcasePricing",
  setup: "profileSetup",
};

/** Demo answers so late onboarding steps render without completing the full flow. */
export function createOnboardingPreviewState() {
  const categoryOptions = JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));
  return {
    categories: ["software", "product", "design"],
    selectedRoles: ["Software Engineer", "Product Manager", "UX Designer"],
    experience: "mid",
    salaryMin: 75000,
    salaryMax: 120000,
    interviewsPerWeek: 4,
    jobTimeline: "3m",
    jobBlocker: "not_applying",
    jobAccomplish: "more_money",
    jobGoal: "asap",
    jobSearchStatus: "yes",
    onboardingLocation: "Paris, France",
    onboardingLocationData: { location_label: "Paris, France" },
    contractType: "permanent",
    triedOtherApps: "no",
    attribution: "search",
    suggestedCategories: categoryOptions,
  };
}

/**
 * Read `?preview=` or `?step=` from the URL for dev previews.
 * Example: /onboarding?preview=final  /onboarding?step=showcaseAllInOne
 */
export function readOnboardingPreviewBoot(stepOrder = ONBOARDING_STEP_ORDER) {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const preview = params.get("preview");
  const stepParam = params.get("step");

  let targetStep = null;
  if (preview && ONBOARDING_PREVIEW_STEP_ALIASES[preview]) {
    targetStep = ONBOARDING_PREVIEW_STEP_ALIASES[preview];
  } else if (stepParam && stepOrder.includes(stepParam)) {
    targetStep = stepParam;
  }

  if (!targetStep) return null;

  const stepIndex = stepOrder.indexOf(targetStep);
  if (stepIndex < 0) return null;

  const welcomeIndex = stepOrder.indexOf("profileWelcome");
  const needsPreviewState = stepIndex >= welcomeIndex;

  return {
    stepIndex,
    state: needsPreviewState ? createOnboardingPreviewState() : null,
  };
}

/** Showcase step screenshots — PNGs under `public/onboarding/`. */
export const ONBOARDING_SHOWCASE_SCREENS = {
  /** Image 1 — swipe feed */
  landing: "/onboarding/showcase-pricing.png",
  /** Image 2 — resume & cover letter */
  allInOne: "/onboarding/showcase-all-in-one.png",
  /** Image 3 — three-phone collage */
  pricing: "/onboarding/showcase-landing.png",
};

/** Job-search pain points — icon + short label for onboarding marquee (Sprout/Framer set). */
export const ONBOARDING_PAIN_POINTS_FR = [
  { id: "follow-up", label: "Oublié de relancer ?", Icon: Bell },
  { id: "no-replies", label: "Des heures à postuler, zéro réponse ?", Icon: Hourglass },
  { id: "reapply", label: "Repostuler par erreur ?", Icon: Repeat },
  { id: "re-enter-info", label: "Re-saisir les mêmes infos ?", Icon: Keyboard },
  { id: "lost-track", label: "Perdu le fil de vos candidatures ?", Icon: FolderOpen },
  { id: "copy-paste", label: "Copier-coller les lettres de motiv ?", Icon: ClipboardCopy },
  { id: "unseen", label: "Personne ne l'a vu ?", Icon: EyeOff },
  { id: "rewrite-cv", label: "Réécrire son CV encore et encore ?", Icon: RefreshCw },
  { id: "duplicate-apps", label: "Doublons sur chaque site ?", Icon: Copy },
  { id: "endless-scroll", label: "Scroller sans fin pour des offres ?", Icon: ScrollText },
  { id: "dear-hiring", label: "Écrire « Madame, Monsieur » encore ?", Icon: PenLine },
  { id: "job-is-job", label: "La recherche d'emploi, c'est un boulot ?", Icon: Briefcase },
  { id: "manual-sheet", label: "Suivi sur tableur Excel ?", Icon: Table2 },
  { id: "others-faster", label: "Les autres avancent plus vite ?", Icon: TrendingUp },
  { id: "burnt-out", label: "À bout de forces ?", Icon: BatteryLow },
  { id: "endless-search", label: "Ça n'en finit plus ?", Icon: Infinity },
  { id: "many-sites", label: "Trop de sites d'emploi ?", Icon: Globe },
  { id: "last-app", label: "Impossible de retrouver sa dernière cand. ?", Icon: Brain },
  { id: "board-spam", label: "Marre du spam des job boards ?", Icon: MailWarning },
  { id: "stuck-sheet", label: "Bloqué sur les tableurs ?", Icon: Sheet },
];

export const ONBOARDING_PAIN_POINTS = [
  { id: "follow-up", label: "Forgot to follow up?", Icon: Bell },
  { id: "no-replies", label: "Hours applying, no replies?", Icon: Hourglass },
  { id: "reapply", label: "Reapplying by accident?", Icon: Repeat },
  { id: "re-enter-info", label: "Re-entering the same info again?", Icon: Keyboard },
  { id: "lost-track", label: "Lost track of applications?", Icon: FolderOpen },
  { id: "copy-paste", label: "Copy-pasting cover letters?", Icon: ClipboardCopy },
  { id: "unseen", label: "No idea if anyone saw it?", Icon: EyeOff },
  { id: "rewrite-cv", label: "Rewriting resumes nonstop?", Icon: RefreshCw },
  { id: "duplicate-apps", label: "Duplicate apps on every site?", Icon: Copy },
  { id: "endless-scroll", label: "Endless scrolling for jobs?", Icon: ScrollText },
  { id: "dear-hiring", label: 'Writing "Dear Hiring Manager" again?', Icon: PenLine },
  { id: "job-is-job", label: "Job hunt feels like a job?", Icon: Briefcase },
  { id: "manual-sheet", label: "Manual spreadsheet tracking?", Icon: Table2 },
  { id: "others-faster", label: "Others landing faster?", Icon: TrendingUp },
  { id: "burnt-out", label: "Feeling burnt out?", Icon: BatteryLow },
  { id: "endless-search", label: "Job search feels endless?", Icon: Infinity },
  { id: "many-sites", label: "Too many job sites?", Icon: Globe },
  { id: "last-app", label: "Can't remember last app?", Icon: Brain },
  { id: "board-spam", label: "Tired of job board spam?", Icon: MailWarning },
  { id: "stuck-sheet", label: "Stuck using spreadsheets?", Icon: Sheet },
];

const PAIN_MARQUEE_ROW_CONFIG = [
  { reverse: false, duration: 420, delayOffset: 0.22 },
  { reverse: true, duration: 470, delayOffset: 0.47 },
  { reverse: false, duration: 390, delayOffset: 0.71 },
  { reverse: true, duration: 440, delayOffset: 0.35 },
];

/** Split pain points into dense marquee rows (staggered, no gaps on load). */
export function buildPainMarqueeRows(points = ONBOARDING_PAIN_POINTS, rowCount = 4) {
  if (!points.length) return [];

  const loops = 2;

  return PAIN_MARQUEE_ROW_CONFIG.slice(0, rowCount).map((cfg, rowIndex) => {
    const tags = [];
    for (let loop = 0; loop < loops; loop += 1) {
      for (let i = 0; i < points.length; i += 1) {
        tags.push(points[(rowIndex + i) % points.length]);
      }
    }
    return { ...cfg, tags };
  });
}

export function getOnboardingPricingPlans(lang = "fr") {
  const isFr = lang === "fr";
  return [
    {
      id: "quarterly",
      label: isFr ? "Trimestriel" : "Quarterly",
      billed: isFr ? "59,99 € / trimestre" : "€59.99 paid quarterly",
      weekly: isFr ? "5,00 €" : "€5.00",
      badge: "33% OFF",
      footnote: isFr ? "Facturé 59,99 € / trimestre" : "Billed as €59.99/quarter",
    },
    {
      id: "monthly",
      label: isFr ? "Mensuel" : "Monthly",
      billed: isFr ? "29,99 € / mois" : "€29.99 paid monthly",
      weekly: isFr ? "7,50 €" : "€7.50",
      badge: null,
      footnote: isFr ? "Facturé 29,99 € / mois" : "Billed as €29.99/month",
    },
  ];
}
export const ONBOARDING_PRICING_PLANS = getOnboardingPricingPlans("fr");

export const SUGGESTED_ONBOARDING_LOCATIONS = [
  "Paris, France",
  "Bordeaux, France",
  "Lyon, France",
  "Marseille, France",
  "Toulouse, France",
  "Nice, France",
  "Nantes, France",
  "Strasbourg, France",
  "Lille, France",
  "Montpellier, France",
  "Provence-Alpes-Côte d'Azur, France",
  "Nouvelle-Aquitaine, France",
  "Île-de-France, France",
  "London, United Kingdom",
  "Manchester, United Kingdom",
  "New York, NY, USA",
  "San Francisco, CA, USA",
  "Los Angeles, CA, USA",
  "Berlin, Germany",
  "Munich, Germany",
  "Barcelona, Spain",
  "Madrid, Spain",
  "Montreal, Canada",
  "Toronto, Canada",
  "Brussels, Belgium",
  "Amsterdam, Netherlands",
];

export const EMPLOYMENT_TYPE_OPTIONS = [
  {
    id: "permanent",
    label: "Permanent contract (CDI)",
    hint: "Open-ended, full-time role.",
    Icon: Briefcase,
  },
  {
    id: "fixed_term",
    label: "Fixed-term contract (CDD)",
    hint: "Temporary contract with an end date.",
    Icon: Clock,
  },
  {
    id: "internship",
    label: "Internship",
    hint: "Student or graduate internship.",
    Icon: GraduationCap,
  },
  {
    id: "apprenticeship",
    label: "Apprenticeship",
    hint: "Work-study or vocational training.",
    Icon: Wrench,
  },
  {
    id: "summer_job",
    label: "Summer job",
    hint: "Short seasonal role during summer break.",
    Icon: Sun,
  },
  { id: "part_time", label: "Part-time", hint: "Reduced hours on an ongoing basis.", Icon: Clock },
  {
    id: "seasonal",
    label: "Seasonal work",
    hint: "Peak-season jobs (harvest, holidays, tourism).",
    Icon: Leaf,
  },
  {
    id: "freelance",
    label: "Freelance / contract",
    hint: "Independent or project-based work.",
    Icon: User,
  },
];

export const EMPLOYMENT_TYPE_OPTIONS_FR = [
  { id: "permanent", label: "CDI", hint: "Poste ouvert, à temps plein.", Icon: Briefcase },
  { id: "fixed_term", label: "CDD", hint: "Contrat temporaire avec date de fin.", Icon: Clock },
  { id: "internship", label: "Stage", hint: "Stage étudiant ou diplômé.", Icon: GraduationCap },
  {
    id: "apprenticeship",
    label: "Alternance / apprentissage",
    hint: "Formation en alternance.",
    Icon: Wrench,
  },
  {
    id: "summer_job",
    label: "Job d'été",
    hint: "Poste saisonnier court pendant l'été.",
    Icon: Sun,
  },
  { id: "part_time", label: "Temps partiel", hint: "Heures réduites sur la durée.", Icon: Clock },
  {
    id: "seasonal",
    label: "Emploi saisonnier",
    hint: "Postes de saison (vendanges, tourisme…).",
    Icon: Leaf,
  },
  {
    id: "freelance",
    label: "Freelance / mission",
    hint: "Travail indépendant ou à la mission.",
    Icon: User,
  },
];

export const JOB_SEARCH_OPTIONS = [
  { id: "yes", label: "Yes", hint: "I'm actively applying to jobs right now.", Icon: Check },
  { id: "kindof", label: "Kind of", hint: "Just seeing what's out there.", Icon: HelpCircle },
  { id: "no", label: "No", hint: "I'm not actively looking for a new job.", Icon: X },
];

export const JOB_SEARCH_OPTIONS_FR = [
  { id: "yes", label: "Oui", hint: "Je postule activement en ce moment.", Icon: Check },
  { id: "kindof", label: "Un peu", hint: "Je regarde juste ce qui existe.", Icon: HelpCircle },
  { id: "no", label: "Non", hint: "Je ne cherche pas activement.", Icon: X },
];

export const OTHER_APPS_OPTIONS = [
  { id: "yes", label: "Yes", Icon: Check },
  { id: "no", label: "No", Icon: X },
];

export const OTHER_APPS_OPTIONS_FR = [
  { id: "yes", label: "Oui", Icon: Check },
  { id: "no", label: "Non", Icon: X },
];

export const JOB_GOAL_OPTIONS = [
  { id: "asap", label: "Land a job ASAP", Icon: Clock },
  { id: "money", label: "Make more money", Icon: DollarSign },
  { id: "dream", label: "Land my dream job", Icon: Star },
];

export const JOB_GOAL_OPTIONS_FR = [
  { id: "asap", label: "Trouver un job au plus vite", Icon: Clock },
  { id: "money", label: "Gagner plus d'argent", Icon: DollarSign },
  { id: "dream", label: "Décrocher le job de mes rêves", Icon: Star },
];

export const JOB_TIMELINE_OPTIONS = [
  { id: "1m", label: "1 month", hint: "Get me a job now!", Icon: Zap },
  { id: "3m", label: "3 months", hint: "I have some time", Icon: Calendar },
  { id: "6m", label: "6 months", hint: "Maximize my options", Icon: Scan },
  { id: "12m", label: "12 months+", hint: "Seeing what's out there", Icon: Umbrella },
];

export const JOB_TIMELINE_OPTIONS_FR = [
  { id: "1m", label: "1 mois", hint: "Trouvez-moi un job maintenant !", Icon: Zap },
  { id: "3m", label: "3 mois", hint: "J'ai un peu de temps", Icon: Calendar },
  { id: "6m", label: "6 mois", hint: "Maximiser mes options", Icon: Scan },
  { id: "12m", label: "12 mois+", hint: "Je vois ce qui existe", Icon: Umbrella },
];

export const JOB_BLOCKER_OPTIONS = [
  { id: "not_applying", label: "Not applying enough", Icon: BatteryLow },
  { id: "no_interviews", label: "Can't land interviews", Icon: Ban },
  { id: "not_ready", label: "Not ready yet", Icon: ListChecks },
  { id: "bad_offers", label: "Lack of great job offers", Icon: ThumbsDown },
];

export const JOB_BLOCKER_OPTIONS_FR = [
  { id: "not_applying", label: "Pas assez de candidatures", Icon: BatteryLow },
  { id: "no_interviews", label: "Pas d'entretiens", Icon: Ban },
  { id: "not_ready", label: "Pas encore prêt(e)", Icon: ListChecks },
  { id: "bad_offers", label: "Manque d'offres intéressantes", Icon: ThumbsDown },
];

export const JOB_ACCOMPLISH_OPTIONS = [
  { id: "more_money", label: "Make a lot more money", Icon: CircleDollarSign },
  { id: "family", label: "Support my family", Icon: Home },
  { id: "exciting", label: "Find a job that excites me", Icon: Sparkles },
  { id: "time_back", label: "Get time back", Icon: Clock },
];

export const JOB_ACCOMPLISH_OPTIONS_FR = [
  { id: "more_money", label: "Gagner beaucoup plus d'argent", Icon: CircleDollarSign },
  { id: "family", label: "Soutenir ma famille", Icon: Home },
  { id: "exciting", label: "Trouver un job qui me passionne", Icon: Sparkles },
  { id: "time_back", label: "Gagner du temps", Icon: Clock },
];

export const INTRO_SLIDES = [
  {
    id: "welcome",
    title: "Welcome to Hirly!",
    body: "Your job application agent—built to learn who you are and apply on your behalf.",
    image: "/onboarding/intro-1.png",
  },
  {
    id: "experts",
    title: "Built by Hiring Experts",
    body: "Designed with career coaches, recruiters, and industry professionals who know what actually gets candidates hired.",
    image: "/onboarding/intro-2.png",
  },
  {
    id: "questions",
    title: "Answer Smart Questions",
    body: "Hirly asks tailored, job-specific questions to capture details most resumes miss.",
    image: "/onboarding/intro-3.png",
  },
  {
    id: "apply",
    title: "One Tap. Fully Applied.",
    body: "Review your resume and cover letter, then submit. Hirly's AI agent applies directly on employer websites.",
    image: "/onboarding/intro-4.png",
  },
  {
    id: "improve",
    title: "It Gets Better Every Time",
    body: "Track applications, interviews, and outcomes. Each application improves the next one automatically.",
    image: "/onboarding/intro-5.png",
  },
];

export const INTRO_SLIDES_FR = [
  {
    id: "welcome",
    title: "Bienvenue sur Hirly !",
    body: "Votre agent de candidature — conçu pour apprendre qui vous êtes et postuler à votre place.",
    image: "/onboarding/intro-1.png",
  },
  {
    id: "experts",
    title: "Créé par des experts RH",
    body: "Conçu avec des coaches carrière, recruteurs et professionnels qui savent ce qui fait décrocher un poste.",
    image: "/onboarding/intro-2.png",
  },
  {
    id: "questions",
    title: "Répondez à des questions ciblées",
    body: "Hirly pose des questions précises pour capturer les détails que la plupart des CV ratent.",
    image: "/onboarding/intro-3.png",
  },
  {
    id: "apply",
    title: "Un tap. Candidature complète.",
    body: "Relisez votre CV et lettre de motivation, puis envoyez. L'agent IA de Hirly postule directement sur les sites employeurs.",
    image: "/onboarding/intro-4.png",
  },
  {
    id: "improve",
    title: "Il s'améliore à chaque fois",
    body: "Suivez candidatures, entretiens et résultats. Chaque candidature améliore automatiquement la suivante.",
    image: "/onboarding/intro-5.png",
  },
];

export const JOB_CATEGORIES = [
  {
    id: "software",
    label: "Software Engineering",
    Icon: Code2,
    roles: [
      "Backend Engineer",
      "Blockchain Engineer",
      "Cloud Engineer",
      "Data Engineer",
      "Developer Relations",
      "DevOps Engineer",
      "Embedded Engineer",
      "Engineering Manager",
      "Frontend Engineer",
      "Fullstack Engineer",
      "Game Engineer",
      "Machine Learning Engineer",
      "Mobile Engineer",
      "Network Engineer",
      "QA Engineer",
      "Sales Engineer",
      "Software Engineer",
      "Site Reliability Engineer",
      "Software Architect",
      "Support Engineer",
    ],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    Icon: HeartPulse,
    roles: [
      "Clinical Research Associate",
      "Clinical Research Coordinator",
      "Epidemiologist",
      "Healthcare Administrator",
      "Healthcare Manager",
      "Licensed Practical Nurse",
      "Medical Biller",
      "Medical Coder",
      "Medical Director",
      "Medical Science Liaison",
      "Mental Health Counselor",
      "Nurse Practitioner",
      "Occupational Therapist",
      "Pharmacist",
      "Pharmacy Technician",
      "Physical Therapist",
      "Physician",
      "Public Health Analyst",
      "Radiologic Technologist",
      "Radiologist",
      "Registered Nurse",
      "Speech-Language Pathologist",
      "Surgeon",
      "Surgical Technologist",
    ],
  },
  {
    id: "consulting",
    label: "Consulting",
    Icon: User,
    roles: [
      "Financial Consultant",
      "IT Consultant",
      "L&D Specialist",
      "Management Consultant",
      "Technology Consultant",
      "Training Manager",
    ],
  },
  {
    id: "data",
    label: "Data",
    Icon: Database,
    roles: ["Data Analyst", "Data Scientist", "Research Engineer", "Salesforce Analyst"],
  },
  {
    id: "design",
    label: "Design",
    Icon: Palette,
    roles: [
      "Brand Designer",
      "Graphic Designer",
      "Industrial Designer",
      "Motion Designer",
      "Product Designer",
      "UI Designer",
      "UX Designer",
    ],
  },
  {
    id: "finance",
    label: "Finance",
    Icon: DollarSign,
    roles: [
      "Accountant",
      "Accounts Payable Specialist",
      "Accounts Receivable Specialist",
      "Bookkeeper",
      "Corporate Finance Manager",
      "Finance Operations Analyst",
      "Financial Analyst",
      "Financial Auditor",
      "Payroll Specialist",
      "Risk Analyst",
    ],
  },
  {
    id: "legal",
    label: "Legal",
    Icon: Scale,
    roles: ["Compliance Officer", "Legal Counsel", "Paralegal"],
  },
  {
    id: "hr",
    label: "Human Resources",
    Icon: Users,
    roles: [
      "Executive Assistant",
      "HR Business Partner",
      "HR Generalist",
      "HR Manager",
      "People Operations Manager",
      "Recruiter",
      "Technical Recruiter",
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    Icon: Megaphone,
    roles: [
      "Brand Manager",
      "Communications Specialist",
      "Community Manager",
      "Content Marketing Manager",
      "Content Strategist",
      "Copywriter",
      "Creative Director",
      "Digital Marketing Manager",
      "Digital Marketing Specialist",
      "Event Manager",
      "Growth Hacker",
      "Growth Marketing Manager",
      "Marketing Analyst",
      "Marketing Generalist",
      "Marketing Operations Manager",
      "Performance Marketing Manager",
      "Product Marketing Manager",
      "Public Relations Manager",
      "SEO Manager",
      "SEO Specialist",
      "Social Media Manager",
    ],
  },
  {
    id: "operations",
    label: "Operations & Strategy",
    Icon: Briefcase,
    roles: [
      "Business Analyst",
      "Business Operations Analyst",
      "Business Operations Manager",
      "Corporate Strategist",
      "Operations Associate",
      "Operations Coordinator",
      "Program Manager",
      "Project Manager",
      "Strategy Manager",
      "Supply Chain Analyst",
      "Supply Chain Manager",
    ],
  },
  {
    id: "product",
    label: "Product",
    Icon: Layers,
    roles: ["Product Analyst", "Product Manager", "Technical Product Manager", "User Researcher"],
  },
  {
    id: "sales",
    label: "Sales",
    Icon: BarChart3,
    roles: [
      "Account Executive",
      "Account Manager",
      "Business Development Manager",
      "Business Development Representative",
      "Channel Sales Manager",
      "Enterprise Account Executive",
      "Partnership Manager",
      "Sales Director",
      "Sales Manager",
      "Sales Operations Analyst",
      "Sales Operations Manager",
      "Technical Account Manager",
      "VP of Sales",
    ],
  },
  {
    id: "customer",
    label: "Customer Success",
    Icon: Headphones,
    roles: [
      "Customer Success Manager",
      "Customer Support Manager",
      "Customer Support Representative",
    ],
  },
  {
    id: "security",
    label: "Security",
    Icon: Shield,
    roles: ["Cybersecurity Analyst", "Cybersecurity Engineer", "Security Engineer"],
  },
  {
    id: "engineering_other",
    label: "Misc. Engineering",
    Icon: Wrench,
    roles: [
      "Hardware Engineer",
      "IT Support Specialist",
      "Mechanical Engineer",
      "Technical Writer",
    ],
  },
  {
    id: "hospitality_food",
    label: "Hospitality & Food",
    Icon: UtensilsCrossed,
    roles: [
      "Server",
      "Waiter",
      "Waitress",
      "Bartender",
      "Restaurant Host",
      "Kitchen Porter",
      "Barista",
      "Hotel Front Desk",
    ],
  },
  {
    id: "retail",
    label: "Retail & Sales Floor",
    Icon: ShoppingBag,
    roles: ["Retail Sales Associate", "Cashier", "Store Supervisor", "Visual Merchandiser"],
  },
  {
    id: "logistics",
    label: "Logistics & Warehouse",
    Icon: Package,
    roles: ["Warehouse Worker", "Picker Packer", "Forklift Operator", "Inventory Clerk"],
  },
  {
    id: "transport",
    label: "Transport & Delivery",
    Icon: Truck,
    roles: ["Delivery Driver", "Courier", "Truck Driver", "Ride-hail Driver"],
  },
  {
    id: "agriculture",
    label: "Agriculture & Harvest",
    Icon: Leaf,
    roles: ["Farm Hand", "Fruit Picker", "Vineyard Worker", "Harvest Worker", "Greenhouse Worker"],
  },
  {
    id: "education_childcare",
    label: "Education & Childcare",
    Icon: GraduationCap,
    roles: ["Teaching Assistant", "Childcare Worker", "Camp Counselor", "Tutor"],
  },
  {
    id: "trades",
    label: "Trades & Construction",
    Icon: Hammer,
    roles: [
      "Electrician Apprentice",
      "Plumber Apprentice",
      "Construction Laborer",
      "Carpenter Helper",
    ],
  },
];

export const EXPERIENCE_LEVELS = [
  { id: "intern", label: "Internship", backend: "entry", Icon: Baby },
  { id: "entry", label: "Entry level & graduate", backend: "entry", Icon: GraduationCap },
  { id: "junior", label: "Junior (1–2 years)", backend: "junior", Icon: User },
  { id: "mid", label: "Mid level (3–5 years)", backend: "mid", Icon: Users },
  { id: "senior", label: "Senior (6–9 years)", backend: "senior", Icon: Star },
  { id: "lead", label: "Expert & leadership (10+ years)", backend: "lead", Icon: Crown },
];

export const EXPERIENCE_LEVELS_FR = [
  { id: "intern", label: "Stage", backend: "entry", Icon: Baby },
  { id: "entry", label: "Débutant & diplômé", backend: "entry", Icon: GraduationCap },
  { id: "junior", label: "Junior (1–2 ans)", backend: "junior", Icon: User },
  { id: "mid", label: "Intermédiaire (3–5 ans)", backend: "mid", Icon: Users },
  { id: "senior", label: "Senior (6–9 ans)", backend: "senior", Icon: Star },
  { id: "lead", label: "Expert & leadership (10+ ans)", backend: "lead", Icon: Crown },
];

export const INTERVIEW_FEEDBACK = [
  { max: 2, label: "Light pace", tone: "muted" },
  { max: 4, label: "Realistic", tone: "good" },
  { max: 6, label: "Ambitious", tone: "good" },
  { max: 10, label: "High volume", tone: "warn" },
];

export const INTERVIEW_FEEDBACK_FR = [
  { max: 2, label: "Rythme léger", tone: "muted" },
  { max: 4, label: "Réaliste", tone: "good" },
  { max: 6, label: "Ambitieux", tone: "good" },
  { max: 10, label: "Volume élevé", tone: "warn" },
];

export const ATTRIBUTION_OPTIONS = [
  { id: "social", label: "Social media", hint: "TikTok, Instagram, LinkedIn, etc.", Icon: Video },
  {
    id: "influencer",
    label: "Influencer",
    hint: "Creator or community you follow",
    Icon: Sparkles,
  },
  { id: "friend", label: "Friend / colleague", hint: "Word of mouth", Icon: Users },
  { id: "search", label: "Search", hint: "Google or app store", Icon: Search },
  { id: "ads", label: "Advertisement", hint: "Online or offline ad", Icon: Megaphone },
  { id: "other", label: "Other", hint: "None of the above", Icon: MessageSquare },
];

export const ATTRIBUTION_OPTIONS_FR = [
  {
    id: "social",
    label: "Réseaux sociaux",
    hint: "TikTok, Instagram, LinkedIn, etc.",
    Icon: Video,
  },
  {
    id: "influencer",
    label: "Influenceur",
    hint: "Créateur ou communauté que vous suivez",
    Icon: Sparkles,
  },
  { id: "friend", label: "Ami / collègue", hint: "Bouche à oreille", Icon: Users },
  { id: "search", label: "Recherche", hint: "Google ou store d'apps", Icon: Search },
  { id: "ads", label: "Publicité", hint: "Pub en ligne ou hors ligne", Icon: Megaphone },
  { id: "other", label: "Autre", hint: "Aucune de ces options", Icon: MessageSquare },
];

export function formatSalary(value, lang) {
  return formatSalaryEuro(value, lang);
}

export function interviewFeedback(count, lang = "fr") {
  const list = lang === "fr" ? INTERVIEW_FEEDBACK_FR : INTERVIEW_FEEDBACK;
  const row = list.find((f) => count <= f.max) || list[list.length - 1];
  return row;
}

export function iconForCategoryLabel(label) {
  const text = (label || "").toLowerCase();
  if (text.includes("software") || text.includes("tech")) return Code2;
  if (text.includes("data")) return Database;
  if (text.includes("design") || text.includes("creative")) return Palette;
  if (text.includes("market")) return Megaphone;
  if (text.includes("retail") || text.includes("sales floor")) return ShoppingBag;
  if (text.includes("sales")) return BarChart3;
  if (text.includes("health") || text.includes("nurse")) return HeartPulse;
  if (text.includes("childcare") || text.includes("education")) return GraduationCap;
  if (text.includes("finance") || text.includes("account")) return DollarSign;
  if (
    text.includes("hospitality") ||
    text.includes("food") ||
    text.includes("restaurant") ||
    text.includes("hotel")
  )
    return UtensilsCrossed;
  if (
    text.includes("agri") ||
    text.includes("harvest") ||
    text.includes("farm") ||
    text.includes("vineyard")
  )
    return Leaf;
  if (text.includes("security")) return Shield;
  if (text.includes("logistic") || text.includes("warehouse")) return Package;
  if (text.includes("transport") || text.includes("delivery") || text.includes("driver"))
    return Truck;
  if (text.includes("trade") || text.includes("construction")) return Hammer;
  if (text.includes("operation") || text.includes("strategy")) return Briefcase;
  if (text.includes("engineering")) return Wrench;
  if (text.includes("legal")) return Scale;
  if (text.includes("consult")) return User;
  if (text.includes("customer")) return Headphones;
  if (text.includes("human") || text.includes("hr")) return Users;
  if (text.includes("product")) return Layers;
  if (text.includes("summer") || text.includes("outdoor")) return Sun;
  return Briefcase;
}

const CATEGORY_ID_ALIASES = {
  hospitality: "hospitality_food",
  food_service: "hospitality_food",
  agriculture_harvest: "agriculture",
  technology: "software",
  engineering: "engineering_other",
  misc: "engineering_other",
  childcare: "education_childcare",
  customer_service: "customer",
  business: "operations",
  logistics_warehousing: "logistics",
};

function resolveJobCategory(id, label) {
  const normalizedId = CATEGORY_ID_ALIASES[id] || id;
  const direct = JOB_CATEGORIES.find((c) => c.id === normalizedId);
  if (direct) return direct;

  const labelText = (label || "").toLowerCase();
  if (labelText) {
    const byLabel = JOB_CATEGORIES.find((c) => c.label.toLowerCase() === labelText);
    if (byLabel) return byLabel;
  }

  const text = `${id || ""} ${label || ""}`.toLowerCase();
  if (
    text.includes("hospitality") ||
    text.includes("food") ||
    text.includes("restaurant") ||
    text.includes("hotel")
  ) {
    return JOB_CATEGORIES.find((c) => c.id === "hospitality_food");
  }
  if (text.includes("retail")) return JOB_CATEGORIES.find((c) => c.id === "retail");
  if (text.includes("agri") || text.includes("harvest") || text.includes("farm")) {
    return JOB_CATEGORIES.find((c) => c.id === "agriculture");
  }
  if (text.includes("logistic") || text.includes("warehouse"))
    return JOB_CATEGORIES.find((c) => c.id === "logistics");
  if (text.includes("transport") || text.includes("delivery"))
    return JOB_CATEGORIES.find((c) => c.id === "transport");
  if (text.includes("trade") || text.includes("construction"))
    return JOB_CATEGORIES.find((c) => c.id === "trades");
  if (text.includes("childcare") || text.includes("education") || text.includes("camp")) {
    return JOB_CATEGORIES.find((c) => c.id === "education_childcare");
  }
  if (text.includes("software") || text.includes("technology"))
    return JOB_CATEGORIES.find((c) => c.id === "software");
  if (text.includes("marketing")) return JOB_CATEGORIES.find((c) => c.id === "marketing");
  if (text.includes("sales")) return JOB_CATEGORIES.find((c) => c.id === "sales");
  if (text.includes("health")) return JOB_CATEGORIES.find((c) => c.id === "healthcare");
  if (text.includes("finance")) return JOB_CATEGORIES.find((c) => c.id === "finance");
  if (text.includes("design")) return JOB_CATEGORIES.find((c) => c.id === "design");
  if (text.includes("data")) return JOB_CATEGORIES.find((c) => c.id === "data");
  if (text.includes("security")) return JOB_CATEGORIES.find((c) => c.id === "security");
  if (text.includes("legal")) return JOB_CATEGORIES.find((c) => c.id === "legal");
  if (text.includes("consult")) return JOB_CATEGORIES.find((c) => c.id === "consulting");
  if (text.includes("customer")) return JOB_CATEGORIES.find((c) => c.id === "customer");
  if (text.includes("operation")) return JOB_CATEGORIES.find((c) => c.id === "operations");
  if (text.includes("human") || text.includes("hr"))
    return JOB_CATEGORIES.find((c) => c.id === "hr");
  if (text.includes("product")) return JOB_CATEGORIES.find((c) => c.id === "product");
  return null;
}

export function rolesForCategories(categoryIds, max = 200, categoryOptions = []) {
  const seen = new Set();
  const out = [];
  for (const selectedId of categoryIds) {
    const option = categoryOptions.find((c) => c.id === selectedId);
    const cat = resolveJobCategory(selectedId, option?.label);
    if (!cat) continue;
    for (const role of cat.roles) {
      if (seen.has(role)) continue;
      seen.add(role);
      out.push(role);
      if (out.length >= max) return out;
    }
  }
  return out;
}
