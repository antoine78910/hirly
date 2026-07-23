/** DataFast attribution cookies for Stripe checkout metadata (revenue attribution). */

import { ONBOARDING_STEP_ORDER } from "../components/onboarding/onboardingData";

const GOAL_NAME_RE = /^[a-z0-9_:-]{1,64}$/;
const INTRO_SLIDE_COUNT = 5;

/** Consolidated goal names — keep the catalog small (DataFast custom-goal limits). */
export const LP_VIEW_GOAL = "lp_view";
export const LP_CTA_GOAL = "lp_cta";
export const ONBOARDING_STARTED_GOAL = "onboarding_started";
export const ONBOARDING_CONTINUE_GOAL = "onboarding_continue";
export const ONBOARDING_SKIP_GOAL = "onboarding_skip";
export const ONBOARDING_SIGNUP_GOAL = "onboarding_signup";
export const ONBOARDING_COMPLETED_GOAL = "onboarding_completed";
export const ONBOARDING_CHECKOUT_STARTED_GOAL = "onboarding_checkout_started";

const _ONBOARDING_STEP_LABELS = {
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
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
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

function _paddedStepNumber(stepNumber) {
  return String(stepNumber).padStart(2, "0");
}

export function onboardingStepNumber(stepId) {
  const index = ONBOARDING_STEP_ORDER.indexOf(stepId);
  return index >= 0 ? index + 1 : null;
}

/** @deprecated Per-step goal names are no longer emitted — use {@link ONBOARDING_CONTINUE_GOAL} + step params. */
export function onboardingContinueGoalName(_stepId) {
  return ONBOARDING_CONTINUE_GOAL;
}

/** @deprecated Per-step skip goal names are no longer emitted — use {@link ONBOARDING_SKIP_GOAL} + step params. */
export function onboardingSkipGoalName(_stepId) {
  return ONBOARDING_SKIP_GOAL;
}

/** @deprecated Intro slides use {@link ONBOARDING_CONTINUE_GOAL} with intro_slide params. */
export function onboardingIntroGoalName(_slideNumber) {
  return ONBOARDING_CONTINUE_GOAL;
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

/** Reference funnel for DataFast — one goal per event type; step detail lives in params. */
export function buildOnboardingDatafastFunnel(introSlideCount = INTRO_SLIDE_COUNT) {
  return [
    { order: 1, goal: LP_VIEW_GOAL, label: "Landing page view" },
    { order: 2, goal: LP_CTA_GOAL, label: "Landing CTA click (location param)" },
    { order: 3, goal: ONBOARDING_STARTED_GOAL, label: "Onboarding started" },
    {
      order: 4,
      goal: ONBOARDING_CONTINUE_GOAL,
      label: `Onboarding continue (${ONBOARDING_STEP_ORDER.length} steps + ${introSlideCount} intro slides via step_id / intro_slide params)`,
    },
    { order: 5, goal: ONBOARDING_SKIP_GOAL, label: "Onboarding skip (step_id param)" },
    { order: 6, goal: ONBOARDING_SIGNUP_GOAL, label: "Sign up (method param)" },
    { order: 7, goal: ONBOARDING_COMPLETED_GOAL, label: "Onboarding completed" },
    { order: 8, goal: ONBOARDING_CHECKOUT_STARTED_GOAL, label: "Checkout started" },
  ];
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
  trackDatafastGoal(ONBOARDING_CONTINUE_GOAL, withStepMeta(stepId, params));
}

export function trackOnboardingIntroContinue(introIndex, slideCount, params = {}) {
  const total = Math.max(1, Number(slideCount) || 1);
  const slideNumber = Math.min(Math.max(0, Number(introIndex) || 0) + 1, total);
  trackDatafastGoal(
    ONBOARDING_CONTINUE_GOAL,
    withStepMeta("intro", {
      intro_slide: String(introIndex),
      intro_total: String(total),
      intro_slide_number: String(slideNumber),
      ...params,
    }),
  );
}

export function trackOnboardingSkip(stepId, params = {}) {
  trackDatafastGoal(ONBOARDING_SKIP_GOAL, withStepMeta(stepId, params));
}

/** Track a successful onboarding signup (Google or email). */
export function trackOnboardingSignup(method, params = {}) {
  trackDatafastGoal(ONBOARDING_SIGNUP_GOAL, { method, ...params });
}

/** All custom DataFast goals currently emitted by the app (for ops / limit audits). */
export const DATAFAST_GOAL_CATALOG = [
  ...ONBOARDING_DATAFAST_FUNNEL.map((row) => row.goal),
  "friend_referral_enrolled",
  "friend_referral_shared",
  "friend_referral_redeemed",
  "friend_referral_progress",
];
