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
  UtensilsCrossed,
  ShoppingBag,
  Package,
  Truck,
  Hammer,
} from "lucide-react";

/** Hirly onboarding step order */
export const ONBOARDING_STEP_ORDER = [
  "intro",           // 5 illustrated intro slides
  "signup",
  "jobSearch",
  "location",
  "contractType",
  "otherApps",
  "longTerm",
  "categories",
  "experience",
  "salary",
  "interviews",
  "interviewsConfirm",
  "potentialChart",
  "compare2x",
  "attribution",
  "referralCode",
  "upload",
  "profileSetup",
  "profileWelcome",
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

/** Personalized “Welcome” cards shown after CV upload, before phone mockup steps. */
export function buildProfileWelcomeItems({
  salaryMin,
  selectedRoles = [],
  categories = [],
  categoryOptions = [],
  interviewsPerWeek = 4,
}) {
  const salaryLabel = formatSalary(salaryMin);
  const primaryRole = selectedRoles[0] || "your target roles";
  const categoryLabels = categories
    .map((id) => categoryOptions.find((c) => c.id === id)?.label)
    .filter(Boolean);
  const industryHint = categoryLabels.length
    ? categoryLabels.slice(0, 2).join(" & ")
    : "top companies";

  return [
    {
      title: "Scale Your Career Fast",
      body: `We'll help you target high-growth teams and roles aligned with your ${salaryLabel}+ salary goal.`,
    },
    {
      title: "Apply at Light Speed",
      body: `Our AI agent automates tailored applications for ${primaryRole} — no more copy-pasting the same answers.`,
    },
    {
      title: "Land Your Next Win",
      body: `Swipe right on ${industryHint} matches. We handle the paperwork while you focus on landing ${interviewsPerWeek} interviews per week.`,
    },
  ];
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

/** Job-search pain points — icon + short label for onboarding marquee. */
export const ONBOARDING_PAIN_POINTS = [
  { id: "no-replies", label: "Hours applying, no replies?", Icon: Hourglass },
  { id: "void", label: "Applications into the void", Icon: Send },
  { id: "copy-paste", label: "Copy-paste cover letters", Icon: ClipboardCopy },
  { id: "ats", label: "ATS filters you out", Icon: Filter },
  { id: "rewrite-cv", label: "Rewriting your CV every time", Icon: RefreshCw },
  { id: "ghosted", label: "Ghosted after interviews", Icon: UserX },
  { id: "no-feedback", label: "Rejections with no feedback", Icon: MessageSquareX },
  { id: "vague-jobs", label: "Job unlike the posting", Icon: Puzzle },
  { id: "hidden-salary", label: "Salary hidden until the end", Icon: CircleDollarSign },
  { id: "long-forms", label: "Endless application forms", Icon: ListChecks },
  { id: "tech-tests", label: "Surprise tech assessments", Icon: FlaskConical },
  { id: "long-process", label: "Months of interview rounds", Icon: Calendar },
  { id: "qual-mismatch", label: "Over- or under-qualified", Icon: TrendingDown },
  { id: "spreadsheet", label: "Tracking apps in a spreadsheet", Icon: Table2 },
  { id: "reapply", label: "Reapplying by accident", Icon: Repeat },
  { id: "unseen", label: "No idea if anyone saw it", Icon: EyeOff },
  { id: "many-sites", label: "Stuck on 10+ job sites", Icon: Globe },
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

export const ONBOARDING_PRICING_PLANS = [
  {
    id: "quarterly",
    label: "Quarterly",
    billed: "€59.99 paid quarterly",
    weekly: "€5.00",
    badge: "33% OFF",
    footnote: "Billed as €59.99/quarter",
  },
  {
    id: "monthly",
    label: "Monthly",
    billed: "€29.99 paid monthly",
    weekly: "€7.50",
    badge: null,
    footnote: "Billed as €29.99/month",
  },
];

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
  { id: "permanent", label: "Permanent contract (CDI)", hint: "Open-ended, full-time role.", Icon: Briefcase },
  { id: "fixed_term", label: "Fixed-term contract (CDD)", hint: "Temporary contract with an end date.", Icon: Clock },
  { id: "internship", label: "Internship", hint: "Student or graduate internship.", Icon: GraduationCap },
  { id: "apprenticeship", label: "Apprenticeship", hint: "Work-study or vocational training.", Icon: Wrench },
  { id: "summer_job", label: "Summer job", hint: "Short seasonal role during summer break.", Icon: Sun },
  { id: "part_time", label: "Part-time", hint: "Reduced hours on an ongoing basis.", Icon: Clock },
  { id: "seasonal", label: "Seasonal work", hint: "Peak-season jobs (harvest, holidays, tourism).", Icon: Leaf },
  { id: "freelance", label: "Freelance / contract", hint: "Independent or project-based work.", Icon: User },
];

export const JOB_SEARCH_OPTIONS = [
  { id: "yes", label: "Yes", hint: "I'm actively applying to jobs right now.", Icon: Check },
  { id: "kindof", label: "Kind of", hint: "Just seeing what's out there.", Icon: HelpCircle },
  { id: "no", label: "No", hint: "I'm not actively looking for a new job.", Icon: X },
];

export const OTHER_APPS_OPTIONS = [
  { id: "yes", label: "Yes", Icon: Check },
  { id: "no", label: "No", Icon: X },
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
    roles: ["Customer Success Manager", "Customer Support Manager", "Customer Support Representative"],
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
    roles: ["Hardware Engineer", "IT Support Specialist", "Mechanical Engineer", "Technical Writer"],
  },
  {
    id: "hospitality_food",
    label: "Hospitality & Food",
    Icon: UtensilsCrossed,
    roles: ["Server", "Waiter", "Waitress", "Bartender", "Restaurant Host", "Kitchen Porter", "Barista", "Hotel Front Desk"],
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
    roles: ["Electrician Apprentice", "Plumber Apprentice", "Construction Laborer", "Carpenter Helper"],
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

export const INTERVIEW_FEEDBACK = [
  { max: 2, label: "Light pace", tone: "muted" },
  { max: 4, label: "Realistic", tone: "good" },
  { max: 6, label: "Ambitious", tone: "good" },
  { max: 10, label: "High volume", tone: "warn" },
];

export const ATTRIBUTION_OPTIONS = [
  { id: "social", label: "Social media", hint: "TikTok, Instagram, LinkedIn, etc.", Icon: Video },
  { id: "influencer", label: "Influencer", hint: "Creator or community you follow", Icon: Sparkles },
  { id: "friend", label: "Friend / colleague", hint: "Word of mouth", Icon: Users },
  { id: "search", label: "Search", hint: "Google or app store", Icon: Search },
  { id: "ads", label: "Advertisement", hint: "Online or offline ad", Icon: Megaphone },
  { id: "other", label: "Other", hint: "None of the above", Icon: MessageSquare },
];

export function formatSalary(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function interviewFeedback(count) {
  const row = INTERVIEW_FEEDBACK.find((f) => count <= f.max) || INTERVIEW_FEEDBACK[INTERVIEW_FEEDBACK.length - 1];
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
  if (text.includes("hospitality") || text.includes("food") || text.includes("restaurant") || text.includes("hotel")) return UtensilsCrossed;
  if (text.includes("agri") || text.includes("harvest") || text.includes("farm") || text.includes("vineyard")) return Leaf;
  if (text.includes("security")) return Shield;
  if (text.includes("logistic") || text.includes("warehouse")) return Package;
  if (text.includes("transport") || text.includes("delivery") || text.includes("driver")) return Truck;
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
  if (text.includes("hospitality") || text.includes("food") || text.includes("restaurant") || text.includes("hotel")) {
    return JOB_CATEGORIES.find((c) => c.id === "hospitality_food");
  }
  if (text.includes("retail")) return JOB_CATEGORIES.find((c) => c.id === "retail");
  if (text.includes("agri") || text.includes("harvest") || text.includes("farm")) {
    return JOB_CATEGORIES.find((c) => c.id === "agriculture");
  }
  if (text.includes("logistic") || text.includes("warehouse")) return JOB_CATEGORIES.find((c) => c.id === "logistics");
  if (text.includes("transport") || text.includes("delivery")) return JOB_CATEGORIES.find((c) => c.id === "transport");
  if (text.includes("trade") || text.includes("construction")) return JOB_CATEGORIES.find((c) => c.id === "trades");
  if (text.includes("childcare") || text.includes("education") || text.includes("camp")) {
    return JOB_CATEGORIES.find((c) => c.id === "education_childcare");
  }
  if (text.includes("software") || text.includes("technology")) return JOB_CATEGORIES.find((c) => c.id === "software");
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
  if (text.includes("human") || text.includes("hr")) return JOB_CATEGORIES.find((c) => c.id === "hr");
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
