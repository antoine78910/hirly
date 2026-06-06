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
  UtensilsCrossed,
  ShoppingBag,
  Package,
  Truck,
  Hammer,
} from "lucide-react";

/** Swiipr onboarding step order */
export const ONBOARDING_STEP_ORDER = [
  "intro",           // 5 illustrated intro slides
  "signup",
  "jobSearch",
  "location",
  "contractType",
  "otherApps",
  "longTerm",
  "categories",
  "roles",
  "experience",
  "salary",
  "interviews",
  "interviewsConfirm",
  "potentialChart",
  "compare2x",
  "attribution",
  "upload",
  "showcaseLanding",
  "showcaseAllInOne",
  "showcasePricing",
];

export const ONBOARDING_PAIN_TAGS = [
  "Hours applying, no replies?",
  "Endless scrolling for jobs?",
  "Reapplying by accident?",
  "Writing 'Dear Hiring Manager' again?",
  "Tracked in a messy spreadsheet?",
  "Forgot which version you sent?",
];

export const ONBOARDING_PRICING_PLANS = [
  {
    id: "quarterly",
    label: "Quarterly",
    billed: "€89.99 paid quarterly",
    weekly: "€7.50",
    badge: "33% OFF",
    footnote: "Billed as €89.99/quarter",
  },
  {
    id: "monthly",
    label: "Monthly",
    billed: "€44.99 paid monthly",
    weekly: "€11.25",
    badge: null,
    footnote: "Billed as €44.99/month",
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
    title: "Welcome to Swiipr!",
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
    body: "Swiipr asks tailored, job-specific questions to capture details most resumes miss.",
    image: "/onboarding/intro-3.png",
  },
  {
    id: "apply",
    title: "One Tap. Fully Applied.",
    body: "Review your resume and cover letter, then submit. Swiipr's AI agent applies directly on employer websites.",
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
  { id: "software", label: "Software Engineering", Icon: Code2, roles: ["Software Engineer", "Frontend Developer", "Backend Developer", "Full Stack Developer", "DevOps Engineer", "QA Engineer"] },
  { id: "data", label: "Data", Icon: Database, roles: ["Data Analyst", "Data Scientist", "Business Analyst"] },
  { id: "product", label: "Product", Icon: Layers, roles: ["Product Manager", "Project Manager", "Product Designer"] },
  { id: "design", label: "Design", Icon: Palette, roles: ["UX/UI Designer", "Graphic Designer", "Content Designer"] },
  { id: "marketing", label: "Marketing", Icon: Megaphone, roles: ["Marketing Manager", "Market Analyst", "Content Designer"] },
  { id: "sales", label: "Sales", Icon: BarChart3, roles: ["Sales Representative", "Account Executive", "Business Development Rep"] },
  { id: "finance", label: "Finance", Icon: Briefcase, roles: ["Finance Analyst", "Accountant", "Financial Advisor"] },
  { id: "healthcare", label: "Healthcare", Icon: HeartPulse, roles: ["Nurse", "Medical Receptionist", "Pharmacy Assistant", "Care Assistant"] },
  { id: "hr", label: "Human Resources", Icon: Users, roles: ["HR Assistant", "Recruiter", "People Operations Coordinator"] },
  { id: "operations", label: "Operations & Strategy", Icon: Briefcase, roles: ["Operations Manager", "Office Manager", "Executive Assistant"] },
  { id: "customer", label: "Customer Success", Icon: Headphones, roles: ["Customer Support Specialist", "Client Success Manager", "Help Desk Agent"] },
  { id: "hospitality_food", label: "Hospitality & Food", Icon: UtensilsCrossed, roles: ["Server", "Waiter", "Waitress", "Bartender", "Restaurant Host", "Kitchen Porter", "Barista", "Hotel Front Desk"] },
  { id: "retail", label: "Retail & Sales Floor", Icon: ShoppingBag, roles: ["Retail Sales Associate", "Cashier", "Store Supervisor", "Visual Merchandiser"] },
  { id: "logistics", label: "Logistics & Warehouse", Icon: Package, roles: ["Warehouse Worker", "Picker Packer", "Forklift Operator", "Inventory Clerk"] },
  { id: "transport", label: "Transport & Delivery", Icon: Truck, roles: ["Delivery Driver", "Courier", "Truck Driver", "Ride-hail Driver"] },
  { id: "agriculture", label: "Agriculture & Harvest", Icon: Leaf, roles: ["Farm Hand", "Fruit Picker", "Vineyard Worker", "Harvest Worker", "Greenhouse Worker"] },
  { id: "education_childcare", label: "Education & Childcare", Icon: GraduationCap, roles: ["Teaching Assistant", "Childcare Worker", "Camp Counselor", "Tutor"] },
  { id: "trades", label: "Trades & Construction", Icon: Hammer, roles: ["Electrician Apprentice", "Plumber Apprentice", "Construction Laborer", "Carpenter Helper"] },
  { id: "security", label: "Security", Icon: Shield, roles: ["Security Guard", "Event Steward", "CCTV Operator"] },
  { id: "engineering_other", label: "Engineering (other)", Icon: Wrench, roles: ["Mechanical Engineer", "Civil Engineer", "Industrial Engineer"] },
  { id: "consulting", label: "Consulting", Icon: User, roles: ["Business Analyst", "Project Manager", "Management Consultant"] },
  { id: "legal", label: "Legal", Icon: Scale, roles: ["Legal Assistant", "Paralegal", "Compliance Analyst"] },
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

export function rolesForCategories(categoryIds, max = 24, categoryOptions = []) {
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
