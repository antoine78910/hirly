import { EXPERIENCE_LEVELS, ONBOARDING_STEP_ORDER } from "../components/onboarding/onboardingData";
import { normalizeReferralCodeInput } from "./friendReferral";

export const ONBOARDING_TRANSIENT_STEPS = new Set(["intro", "signup", "profileSetup"]);

export function experienceIdFromSeniority(seniority) {
  if (!seniority) return null;
  const match = EXPERIENCE_LEVELS.find(
    (level) => level.id === seniority || level.backend === seniority,
  );
  return match?.id ?? null;
}

export function normalizeResumeStep(step, { user, profile } = {}) {
  if (!step || !ONBOARDING_STEP_ORDER.includes(step)) {
    return user ? "jobSearch" : "intro";
  }
  if (user && ONBOARDING_TRANSIENT_STEPS.has(step)) {
    return "jobSearch";
  }
  if (step === "profileSetup") {
    if (!(profile?.cv_text || profile?.cv_filename)) return "upload";
    return "profileWelcome";
  }
  if (step === "upload" && (profile?.cv_text || profile?.cv_filename)) {
    return "profileSetup";
  }
  const contactPhoneIndex = ONBOARDING_STEP_ORDER.indexOf("contactPhone");
  const stepIndex = ONBOARDING_STEP_ORDER.indexOf(step);
  if (step === "contactPhone" && profile?.contact?.phone?.trim()) {
    return ONBOARDING_STEP_ORDER[contactPhoneIndex + 1] || "salary";
  }
  if (
    user
    && stepIndex > contactPhoneIndex
    && !(profile?.contact?.phone?.trim())
  ) {
    return "contactPhone";
  }
  return step;
}

export function inferOnboardingStepFromProgress({ onboarding = {}, profile = null, user = null }) {
  if (!user) return "intro";

  const data = onboarding || {};
  if (!data.job_search_status) return "jobSearch";
  if (!data.job_goal) return "jobGoal";
  if (!data.contract_type && !profile?.contract_type) return "contractType";
  if (data.tried_other_apps == null) return "otherApps";
  if (!Array.isArray(data.categories) || !data.categories.length) return "categories";
  if (!data.experience && !profile?.seniority) return "experience";
  if (!data.onboarding_location && !profile?.target_location) return "location";
  if (!profile?.contact?.phone?.trim()) return "contactPhone";
  if (!data.acquisition_source) return "attribution";
  if (!(profile?.cv_text || profile?.cv_filename)) return "upload";
  if (profile?.target_role && profile?.cv_text) return "showcasePricing";
  return "showcasePricing";
}

export function resolveOnboardingResumeStep({
  stepParam,
  onboarding = {},
  profile = null,
  user = null,
}) {
  const lastStep = onboarding?.last_step;
  const lastIndex = lastStep ? ONBOARDING_STEP_ORDER.indexOf(lastStep) : -1;
  const paramIndex = stepParam && ONBOARDING_STEP_ORDER.includes(stepParam)
    ? ONBOARDING_STEP_ORDER.indexOf(stepParam)
    : -1;

  let targetStep = null;
  if (lastIndex >= 0 && lastIndex >= paramIndex) {
    targetStep = lastStep;
  } else if (paramIndex >= 0) {
    targetStep = stepParam;
  } else if (lastIndex >= 0) {
    targetStep = lastStep;
  } else {
    targetStep = inferOnboardingStepFromProgress({ onboarding, profile, user });
  }

  return normalizeResumeStep(targetStep, { user, profile });
}

export function buildOnboardingExtrasPayload(state) {
  const {
    jobSearchStatus,
    onboardingLocation,
    onboardingLocationData,
    contractType,
    triedOtherApps,
    categories,
    suggestedCategories,
    selectedRoles,
    experience,
    interviewsPerWeek,
    jobTimeline,
    jobBlocker,
    jobAccomplish,
    jobGoal,
    attribution,
    referralCode,
    salaryMin,
    salaryMax,
    selectedPlan,
    phone,
    lastStep,
    lastStepIndex,
  } = state;

  return {
    job_search_status: jobSearchStatus,
    onboarding_location: onboardingLocationData?.location_label || onboardingLocation,
    onboarding_location_data: onboardingLocationData,
    contract_type: contractType,
    job_priorities: [],
    tried_other_apps: triedOtherApps,
    categories,
    suggested_categories: suggestedCategories,
    selected_roles: selectedRoles,
    experience,
    interviews_per_week: interviewsPerWeek,
    job_timeline: jobTimeline,
    job_blocker: jobBlocker,
    job_accomplish: jobAccomplish,
    job_goal: jobGoal,
    acquisition_source: attribution,
    referral_code: referralCode?.trim()?.toUpperCase() || null,
    salary_min: salaryMin,
    salary_max: salaryMax,
    selected_plan: selectedPlan,
    phone: phone || null,
    last_step: lastStep,
    last_step_index: lastStepIndex,
  };
}

export function applyOnboardingSnapshot(snapshot, profile, setters) {
  const onboarding = snapshot || profile?.extras?.onboarding || {};
  const {
    setCategories,
    setSelectedRoles,
    setExperience,
    setSalaryMin,
    setSalaryMax,
    setInterviewsPerWeek,
    setJobTimeline,
    setJobBlocker,
    setJobAccomplish,
    setJobGoal,
    setJobSearchStatus,
    setOnboardingLocation,
    setOnboardingLocationData,
    setContractType,
    setTriedOtherApps,
    setAttribution,
    setSuggestedCategories,
    setSelectedPlan,
    setReferralCode,
    setProfile,
  } = setters;

  if (Array.isArray(onboarding.categories)) setCategories(onboarding.categories);
  if (Array.isArray(onboarding.selected_roles)) setSelectedRoles(onboarding.selected_roles);
  if (onboarding.experience) {
    setExperience(onboarding.experience);
  } else if (profile?.seniority) {
    const inferred = experienceIdFromSeniority(profile.seniority);
    if (inferred) setExperience(inferred);
  }
  if (typeof onboarding.salary_min === "number") setSalaryMin(onboarding.salary_min);
  if (typeof onboarding.salary_max === "number") setSalaryMax(onboarding.salary_max);
  if (typeof onboarding.interviews_per_week === "number") setInterviewsPerWeek(onboarding.interviews_per_week);
  if (onboarding.job_timeline) setJobTimeline(onboarding.job_timeline);
  if (onboarding.job_blocker) setJobBlocker(onboarding.job_blocker);
  if (onboarding.job_accomplish) setJobAccomplish(onboarding.job_accomplish);
  if (onboarding.job_goal) setJobGoal(onboarding.job_goal);
  if (onboarding.job_search_status) setJobSearchStatus(onboarding.job_search_status);
  if (onboarding.onboarding_location) setOnboardingLocation(onboarding.onboarding_location);
  if (onboarding.onboarding_location_data) {
    setOnboardingLocationData(onboarding.onboarding_location_data);
  } else if (profile?.target_location_data) {
    setOnboardingLocationData(profile.target_location_data);
    setOnboardingLocation(profile.target_location || "");
  } else if (profile?.target_location) {
    setOnboardingLocation(profile.target_location);
  }
  if (onboarding.contract_type) {
    setContractType(onboarding.contract_type);
  } else if (profile?.contract_type) {
    setContractType(profile.contract_type);
  }
  if (onboarding.tried_other_apps != null) setTriedOtherApps(onboarding.tried_other_apps);
  if (onboarding.acquisition_source) setAttribution(onboarding.acquisition_source);
  if (Array.isArray(onboarding.suggested_categories)) setSuggestedCategories(onboarding.suggested_categories);
  if (onboarding.selected_plan) setSelectedPlan(onboarding.selected_plan);
  if (onboarding.referral_code) setReferralCode(normalizeReferralCodeInput(onboarding.referral_code));
  if (profile && (profile.cv_text || profile.target_role)) setProfile(profile);
}
