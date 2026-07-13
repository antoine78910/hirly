import {
  ATTRIBUTION_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_LEVELS,
  JOB_ACCOMPLISH_OPTIONS,
  JOB_BLOCKER_OPTIONS,
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
