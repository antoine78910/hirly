export const ONBOARDING_ANSWER_LABELS = {
  job_search_status: "Job search status",
  onboarding_location: "Where they search",
  contract_type: "Contract type",
  tried_other_apps: "Tried other apps",
  categories: "Job categories",
  suggested_categories: "Suggested categories",
  selected_roles: "Selected roles",
  seniority: "Experience level",
  interviews_per_week: "Target interviews / week",
  acquisition_source: "How they found us",
  referral_code: "Referral code",
  salary_min: "Salary min",
  salary_max: "Salary max",
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
    return `$${value.toLocaleString("en-US")}`;
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
