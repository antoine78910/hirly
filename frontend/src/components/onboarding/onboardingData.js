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
} from "lucide-react";

/** Swiipr onboarding step order */
export const ONBOARDING_STEP_ORDER = [
  "intro",           // 5 illustrated intro slides
  "signup",
  "jobSearch",
  "location",
  "contractType",
  "jobPriorities",
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
  "welcome",
  "preferences",
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

export const JOB_PRIORITIES = [
  { id: "meaningful", label: "Meaningful work", Icon: Briefcase },
  { id: "leaders", label: "Experienced leaders", Icon: User },
  { id: "investors", label: "Top investors", Icon: TrendingUp },
  { id: "many_hats", label: "Wear many hats", Icon: Layers },
  { id: "smart_people", label: "Work with smart people", Icon: Brain },
  { id: "challenging", label: "Challenging work", Icon: Rocket },
  { id: "growing", label: "Growing fast", Icon: BarChart3 },
  { id: "startup", label: "Cool startup", Icon: Sparkles },
  { id: "stable", label: "Stable company", Icon: Building2 },
  { id: "innovative", label: "Innovative technology", Icon: Laptop },
  { id: "flexible", label: "Flexible hours", Icon: Clock },
  { id: "benefits", label: "Great benefits", Icon: Gift },
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
  { id: "sales", label: "Sales", Icon: BarChart3, roles: ["Sales Representative", "Customer Support"] },
  { id: "finance", label: "Finance", Icon: Briefcase, roles: ["Finance Analyst", "Accountant", "Financial Advisor"] },
  { id: "healthcare", label: "Healthcare", Icon: HeartPulse, roles: ["Nurse", "Medical Receptionist", "Pharmacy Assistant", "Care Assistant"] },
  { id: "hr", label: "Human Resources", Icon: Users, roles: ["HR Assistant", "Operations Manager", "Administrative Assistant"] },
  { id: "operations", label: "Operations & Strategy", Icon: Briefcase, roles: ["Operations Manager", "Office Manager", "Executive Assistant"] },
  { id: "customer", label: "Customer Success", Icon: Headphones, roles: ["Customer Support", "Sales Representative"] },
  { id: "security", label: "Security", Icon: Shield, roles: ["Security Guard", "IT Support Specialist"] },
  { id: "misc", label: "Misc. Engineering", Icon: Wrench, roles: ["Warehouse Worker", "Driver", "Retail Assistant"] },
  { id: "consulting", label: "Consulting", Icon: User, roles: ["Business Analyst", "Project Manager", "Market Analyst"] },
  { id: "legal", label: "Legal", Icon: Scale, roles: ["Administrative Assistant", "Executive Assistant"] },
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
  if (text.includes("software") || text.includes("tech") || text.includes("data")) return Code2;
  if (text.includes("design") || text.includes("creative")) return Palette;
  if (text.includes("market") || text.includes("sales") || text.includes("retail")) return Megaphone;
  if (text.includes("health") || text.includes("care") || text.includes("nurse")) return HeartPulse;
  if (text.includes("finance") || text.includes("account")) return DollarSign;
  if (text.includes("hospitality") || text.includes("food") || text.includes("hotel")) return Headphones;
  if (text.includes("agri") || text.includes("harvest") || text.includes("farm") || text.includes("vineyard")) return Leaf;
  if (text.includes("security")) return Shield;
  if (text.includes("operation") || text.includes("logistic") || text.includes("warehouse")) return Wrench;
  if (text.includes("summer") || text.includes("outdoor")) return Sun;
  return Briefcase;
}

export function rolesForCategories(categoryIds, max = 24) {
  const seen = new Set();
  const out = [];
  for (const cat of JOB_CATEGORIES) {
    if (!categoryIds.includes(cat.id)) continue;
    for (const role of cat.roles) {
      if (seen.has(role)) continue;
      seen.add(role);
      out.push(role);
      if (out.length >= max) return out;
    }
  }
  return out;
}
