import {
  ATTRIBUTION_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_LEVELS,
  JOB_ACCOMPLISH_OPTIONS,
  JOB_BLOCKER_OPTIONS,
  JOB_CATEGORIES,
  JOB_GOAL_OPTIONS,
  JOB_SEARCH_OPTIONS,
  JOB_TIMELINE_OPTIONS,
  OTHER_APPS_OPTIONS,
} from "../components/onboarding/onboardingData";

function buildOptionLabelMap(...optionLists) {
  const map = {};
  for (const list of optionLists) {
    for (const option of list || []) {
      if (!option?.id) continue;
      map[option.id] = option.label;
      if (option.backend) map[option.backend] = option.label;
    }
  }
  return map;
}

const ONBOARDING_OPTION_LABELS = buildOptionLabelMap(
  JOB_SEARCH_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  OTHER_APPS_OPTIONS,
  JOB_GOAL_OPTIONS,
  JOB_TIMELINE_OPTIONS,
  JOB_BLOCKER_OPTIONS,
  JOB_ACCOMPLISH_OPTIONS,
  EXPERIENCE_LEVELS,
  ATTRIBUTION_OPTIONS,
);

const ONBOARDING_CHOICE_KEYS = new Set([
  "job_search_status",
  "contract_type",
  "tried_other_apps",
  "job_goal",
  "job_timeline",
  "job_blocker",
  "job_accomplish",
  "experience",
  "seniority",
  "acquisition_source",
  "selected_plan",
]);

export const ONBOARDING_ANSWER_LABELS = {
  job_search_status: "Job search status",
  job_goal: "Job goal",
  onboarding_location: "Where they search",
  contract_type: "Contract type",
  tried_other_apps: "Tried other apps",
  categories: "Job categories",
  suggested_categories: "Suggested categories",
  selected_roles: "Selected roles",
  experience: "Experience level",
  seniority: "Seniority (profile)",
  phone: "Phone",
  interviews_per_week: "Target interviews / week",
  job_timeline: "Target timeline",
  job_blocker: "Main blocker",
  job_accomplish: "What they want to accomplish",
  acquisition_source: "How they found us",
  referral_code: "Referral code",
  salary_min: "Salary min",
  salary_max: "Salary max",
  selected_plan: "Plan at checkout",
  last_step: "Last onboarding step",
  job_priorities: "Job priorities",
};

export function formatOnboardingAnswerValue(key, value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return value
      .map((item) => (typeof item === "object" ? item?.label || item?.id || JSON.stringify(item) : String(item)))
      .join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if ((key === "salary_min" || key === "salary_max") && typeof value === "number") {
    return `€${value.toLocaleString("fr-FR")}`;
  }
  if (key === "selected_plan") {
    if (value === "quarterly") return "Quarterly";
    if (value === "monthly") return "Monthly";
  }
  if (ONBOARDING_CHOICE_KEYS.has(key) && typeof value === "string") {
    return ONBOARDING_OPTION_LABELS[value] || value;
  }
  return String(value);
}

const CATEGORY_LABELS = Object.fromEntries(JOB_CATEGORIES.map((cat) => [cat.id, cat.label]));

// One entry per single-choice onboarding step we want to chart. `title` mirrors
// the question shown to the user so admins can map the chart back to the step.
const SINGLE_CHOICE_STEPS = [
  { key: "job_search_status", title: "Are you looking for a job?" },
  { key: "job_goal", title: "What's your main goal?" },
  { key: "contract_type", title: "Contract type" },
  { key: "tried_other_apps", title: "Tried other job apps?" },
  { key: "experience", title: "Experience level" },
  { key: "job_timeline", title: "Target timeline" },
  { key: "job_blocker", title: "Main blocker" },
  { key: "job_accomplish", title: "What they want to accomplish" },
  { key: "acquisition_source", title: "How they found us" },
  { key: "selected_plan", title: "Plan picked at checkout" },
];

function buildStepResult(key, title, counts, total, topN) {
  const options = Array.from(counts.entries())
    .map(([label, count]) => ({
      label,
      count,
      pct: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  return { key, title, total, options };
}

/** Aggregates every user's onboarding answers into "most chosen option" per step. */
export function buildOnboardingAnswerDistribution(users, { topN = 6 } = {}) {
  const results = [];

  for (const step of SINGLE_CHOICE_STEPS) {
    const counts = new Map();
    let total = 0;
    for (const user of users || []) {
      const value = user?.onboarding_answers?.[step.key];
      if (value == null || value === "") continue;
      total += 1;
      const label = formatOnboardingAnswerValue(step.key, value);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (total > 0) results.push(buildStepResult(step.key, step.title, counts, total, topN));
  }

  const categoryCounts = new Map();
  let categoryTotal = 0;
  for (const user of users || []) {
    const items = user?.onboarding_answers?.categories;
    if (!Array.isArray(items) || !items.length) continue;
    for (const item of items) {
      const id = typeof item === "object" ? item?.id : item;
      const label = CATEGORY_LABELS[id] || (typeof item === "object" ? item?.label : id);
      if (!label) continue;
      categoryCounts.set(label, (categoryCounts.get(label) || 0) + 1);
      categoryTotal += 1;
    }
  }
  if (categoryTotal > 0) {
    results.push(buildStepResult("categories", "Job categories picked", categoryCounts, categoryTotal, topN));
  }

  const roleCounts = new Map();
  let roleTotal = 0;
  for (const user of users || []) {
    const items = user?.onboarding_answers?.selected_roles;
    if (!Array.isArray(items) || !items.length) continue;
    for (const item of items) {
      const label = typeof item === "object" ? item?.label || item?.id : item;
      if (!label) continue;
      roleCounts.set(label, (roleCounts.get(label) || 0) + 1);
      roleTotal += 1;
    }
  }
  if (roleTotal > 0) {
    results.push(buildStepResult("selected_roles", "Roles picked", roleCounts, roleTotal, topN));
  }

  const locationCounts = new Map();
  let locationTotal = 0;
  for (const user of users || []) {
    const value = String(user?.onboarding_answers?.onboarding_location || "").trim();
    if (!value) continue;
    locationTotal += 1;
    locationCounts.set(value, (locationCounts.get(value) || 0) + 1);
  }
  if (locationTotal > 0) {
    results.push(buildStepResult("onboarding_location", "Where they search", locationCounts, locationTotal, topN));
  }

  return results;
}

export function onboardingStatusLabel(progress) {
  if (!progress) return "Not started";
  if (progress.completed) return "Completed";
  if (progress.drop_off_step_label) return `Stuck: ${progress.drop_off_step_label}`;
  if (progress.started_at) return "Started";
  return "Not started";
}

export function fmtDuration(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return "—";
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function fmtDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
