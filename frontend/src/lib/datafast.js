/** DataFast attribution cookies for Stripe checkout metadata (revenue attribution). */

const GOAL_NAME_RE = /^[a-z0-9_:-]{1,64}$/;

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
  trackDatafastGoal(`onboarding_next_${camelToSnake(stepId)}`, params);
}

/** One goal per intro slide (1-based) so funnel counts are not inflated by 5×. */
export function trackOnboardingIntroContinue(introIndex, slideCount, params = {}) {
  const total = Math.max(1, Number(slideCount) || 1);
  const slideNumber = Math.min(Math.max(0, Number(introIndex) || 0) + 1, total);
  trackDatafastGoal(`onboarding_next_intro_${slideNumber}`, {
    intro_slide: String(introIndex),
    intro_total: String(total),
    ...params,
  });
}

export function trackOnboardingSkip(stepId, params = {}) {
  trackDatafastGoal(`onboarding_skip_${camelToSnake(stepId)}`, params);
}
