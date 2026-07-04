/** Desktop upgrade modal — subscription tiers (amounts in EUR). */

export const UPGRADE_FEATURES = [
  {
    title: "Swipe to Apply",
    description: "Apply to hundreds of jobs with just a swipe — no more tedious forms.",
    icon: "zap",
  },
  {
    title: "AI-Generated Resumes",
    description: "Automatically create tailored resumes for each job application.",
    icon: "sparkles",
  },
  {
    title: "AI Cover Letters",
    description: "Personalized cover letters written by AI for every application.",
    icon: "rocket",
  },
  {
    title: "Smart Job Matching",
    description: "AI learns your preferences to show you the perfect opportunities.",
    icon: "check",
  },
];

export const UPGRADE_STATS = [
  { value: "1M+", label: "Downloads" },
  { value: "3M+", label: "Jobs Available" },
  { value: "4.8 ★", label: "Rating" },
];

export const UPGRADE_BENEFITS = [
  {
    title: "Perfect timing advantage",
    description: "Job postings are fresh — apply before competition floods in.",
    icon: "zap",
  },
  {
    title: "Instant application power",
    description: "Credits activate immediately — no waiting, no delays.",
    icon: "rocket",
  },
  {
    title: "AI-powered precision",
    description: "Every application is tailored for maximum impact.",
    icon: "sparkles",
  },
  {
    title: "Higher success rate",
    description: "More applications mean more interviews and better odds.",
    icon: "heart",
  },
];

export const SUBSCRIPTION_TIERS = [
  {
    id: "ultra",
    name: "ULTRA",
    monthlyPrice: 69.99,
    weeklyPrice: 22.99,
    applications: 600,
    popular: true,
  },
  {
    id: "pro",
    name: "PRO",
    monthlyPrice: 29.99,
    weeklyPrice: 11.99,
    applications: 200,
  },
  {
    id: "basic",
    name: "BASIC",
    monthlyPrice: 14.99,
    weeklyPrice: 5.99,
    applications: 80,
  },
];

export function isDesktopViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 768px)").matches;
}
