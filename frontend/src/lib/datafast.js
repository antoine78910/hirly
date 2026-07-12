/** DataFast attribution cookies for Stripe checkout metadata (revenue attribution). */

import { ONBOARDING_STEP_ORDER } from "../components/onboarding/onboardingData";

const GOAL_NAME_RE = /^[a-z0-9_:-]{1,64}$/;
const INTRO_SLIDE_COUNT = 5;

const ONBOARDING_STEP_LABELS = {
  intro: "Intro slides",
  signup: "Sign up",
  jobSearch: "Job search status",
  jobGoal: "Job goal",
  compare2x: "2× interviews comparison",
  contractType: "Contract type",
  otherApps: "Other apps used",
  longTerm: "Long-term results",
  categories: "Job categories",
  experience: "Experience level",
  location: "Target location",
  contactPhone: "Phone number",
  salary: "Salary expectations",
  interviews: "Interviews per week",
  jobTimeline: "Job search timeline",
  interviewsConfirm: "Interviews confirmation",
  jobBlocker: "Job search blocker",
  jobAccomplish: "Job search goal",
  potentialChart: "Interview potential",
  attribution: "Acquisition source",
  referralCode: "Referral code",
  upload: "CV upload",
  profileSetup: "Profile setup",
  profileWelcome: "Profile welcome",
  showcaseLanding: "Showcase — landing",
  showcaseAllInOne: "Showcase — all-in-one",
  showcasePricing: "Pricing / checkout",
};

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Return DataFast IDs to send with server-side Stripe Checkout creation. */
export function getDatafastAttribution() {
  const datafast_visitor_id = readCookie("datafast_visitor_id");
  const datafast_session_id = readCookie("datafast_session_id");
  const payload = {};
  if (datafast_visitor_id) payload.datafast_visitor_id = datafast_visitor_id;
  if (datafast_session_id) payload.datafast_session_id = datafast_session_id;
  return payload;
}

/** Merge DataFast attribution into a checkout session request body. */
export function withDatafastAttribution(body = {}) {
  return { ...body, ...getDatafastAttribution() };
}

function camelToSnake(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

function sanitizeGoalName(goalName) {
  const name = String(goalName || "")
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "_")
    .slice(0, 64);
  return GOAL_NAME_RE.test(name) ? name : "";
}

function sanitizeGoalParams(params = {}) {
  const out = {};
  let count = 0;
  for (const [key, raw] of Object.entries(params)) {
    if (count >= 10) break;
    const name = camelToSnake(key).slice(0, 64);
    if (!name) continue;
    out[name] = raw == null ? "" : String(raw).slice(0, 255);
    count += 1;
  }
  return out;
}

function paddedStepNumber(stepNumber) {
  return String(stepNumber).padStart(2, "0");
}

export function onboardingStepNumber(stepId) {
  const index = ONBOARDING_STEP_ORDER.indexOf(stepId);
  return index >= 0 ? index + 1 : null;
}

export function onboardingContinueGoalName(stepId) {
  const stepNumber = onboardingStepNumber(stepId);
  const slug = camelToSnake(stepId);
  if (!stepNumber) return `onboarding_next_${slug}`;
  return `onboarding_step_${paddedStepNumber(stepNumber)}_${slug}`;
}

export function onboardingSkipGoalName(stepId) {
  const stepNumber = onboardingStepNumber(stepId);
  const slug = camelToSnake(stepId);
  if (!stepNumber) return `onboarding_skip_${slug}`;
  return `onboarding_skip_${paddedStepNumber(stepNumber)}_${slug}`;
}

export function onboardingIntroGoalName(slideNumber) {
  const stepNumber = onboardingStepNumber("intro") || 1;
  return `onboarding_step_${paddedStepNumber(stepNumber)}_intro_${slideNumber}`;
}

function withStepMeta(stepId, params = {}) {
  const stepNumber = onboardingStepNumber(stepId);
  if (stepNumber == null) return params;
  return {
    step_number: String(stepNumber),
    step_index: String(stepNumber - 1),
    step_id: stepId,
    ...params,
  };
}

/** Ordered funnel reference for DataFast — mirrors ONBOARDING_STEP_ORDER. */
export function buildOnboardingDatafastFunnel(introSlideCount = INTRO_SLIDE_COUNT) {
  const funnel = [
    { order: 1, goal: "lp_view", label: "Landing page view" },
    { order: 2, goal: "lp_cta_start", label: "Get Started (LP)" },
    { order: 3, goal: "onboarding_started", label: "Onboarding started" },
  ];

  let order = 4;
  ONBOARDING_STEP_ORDER.forEach((stepId) => {
    const stepNumber = onboardingStepNumber(stepId);
    if (stepId === "intro") {
      for (let slide = 1; slide <= introSlideCount; slide += 1) {
        funnel.push({
          order: order++,
          goal: onboardingIntroGoalName(slide),
          label: `Intro slide ${slide}`,
          step_id: stepId,
          step_number: stepNumber,
        });
      }
      return;
    }

    if (stepId === "signup") {
      funnel.push({
        order: order++,
        goal: onboardingContinueGoalName(stepId),
        label: ONBOARDING_STEP_LABELS[stepId] || stepId,
        step_id: stepId,
        step_number: stepNumber,
      });
      funnel.push({ order: order++, goal: "onboarding_signup_google", label: "Sign up with Google", step_id: stepId, step_number: stepNumber });
      funnel.push({ order: order++, goal: "onboarding_signup_email", label: "Sign up with email", step_id: stepId, step_number: stepNumber });
      return;
    }

    funnel.push({
      order: order++,
      goal: onboardingContinueGoalName(stepId),
      label: ONBOARDING_STEP_LABELS[stepId] || stepId,
      step_id: stepId,
      step_number: stepNumber,
    });
  });

  funnel.push({ order: order++, goal: "onboarding_completed", label: "Onboarding completed" });
  funnel.push({ order: order++, goal: "onboarding_checkout_started", label: "Checkout started" });
  return funnel;
}

export const ONBOARDING_DATAFAST_FUNNEL = buildOnboardingDatafastFunnel();

/** Track a DataFast custom goal (https://datafa.st/docs/custom-goals). */
export function trackDatafastGoal(goalName, params) {
  if (typeof window === "undefined") return;
  const name = sanitizeGoalName(goalName);
  if (!name) return;
  try {
    const fn = window.datafast;
    if (typeof fn !== "function") return;
    const custom = params ? sanitizeGoalParams(params) : {};
    if (Object.keys(custom).length > 0) fn(name, custom);
    else fn(name);
  } catch {
    /* ignore analytics failures */
  }
}

export function trackOnboardingContinue(stepId, params = {}) {
  trackDatafastGoal(onboardingContinueGoalName(stepId), withStepMeta(stepId, params));
}

/** One goal per intro slide (1-based) so funnel counts are not inflated by 5×. */
export function trackOnboardingIntroContinue(introIndex, slideCount, params = {}) {
  const total = Math.max(1, Number(slideCount) || 1);
  const slideNumber = Math.min(Math.max(0, Number(introIndex) || 0) + 1, total);
  trackDatafastGoal(onboardingIntroGoalName(slideNumber), withStepMeta("intro", {
    intro_slide: String(introIndex),
    intro_total: String(total),
    intro_slide_number: String(slideNumber),
    ...params,
  }));
}

export function trackOnboardingSkip(stepId, params = {}) {
  trackDatafastGoal(onboardingSkipGoalName(stepId), withStepMeta(stepId, params));
}
