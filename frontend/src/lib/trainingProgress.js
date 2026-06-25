/** Gamified chapter progress — micro-event tracking + fraction computation. */

const EVENTS_PREFIX = "hirly_training_events_";

/** Modules that count towards the course progress bar (Content Bank examples excluded). */
export const SCORED_MODULE_IDS = [
  "mod_getting_started",
  "mod_warm_up",
  "mod_creating_content",
  "mod_account_management",
  "mod_submit_drafts",
];

export const CONTENT_BANK_MODULE_ID = "mod_content_bank";

export function isContentBankModule(module) {
  if (!module) return false;
  return module.module_id === CONTENT_BANK_MODULE_ID || module.category === "reference";
}

function eventsKey(courseId) {
  return `${EVENTS_PREFIX}${courseId || "default"}`;
}

export function loadProgressEvents(courseId) {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(eventsKey(courseId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save a micro-event for a module.
 * Returns `true` if this is a new event (triggers re-render), `false` if already recorded.
 */
export function saveProgressEvent(courseId, moduleId, eventKey) {
  if (!SCORED_MODULE_IDS.includes(moduleId)) return false;
  if (typeof window === "undefined") return false;
  try {
    const all = loadProgressEvents(courseId);
    if (all[moduleId]?.[eventKey]) return false;
    if (!all[moduleId]) all[moduleId] = {};
    all[moduleId][eventKey] = Date.now();
    window.localStorage.setItem(eventsKey(courseId), JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** All possible event slots for a module, used to compute fraction. */
function moduleEventSlots(module) {
  const slots = ["visited", "scrolled"];

  const hasVideo =
    !!module?.video_url ||
    (module?.sections || []).some((s) => s.video_url);
  if (hasVideo) slots.push("video");

  // All 5 scored modules have a quiz
  slots.push("quiz");

  // Each section tab counts as a visit
  (module?.sections || []).forEach((s) => {
    slots.push(`section_${s.section_id}`);
  });

  return slots;
}

/**
 * Fraction 0–1 for a single module.
 * Completed modules always return 1.
 */
export function moduleProgressFraction(courseId, module, quizResults) {
  if (!module) return 0;
  if (module.completed) return 1;

  const slots = moduleEventSlots(module);
  const events = loadProgressEvents(courseId)[module.module_id] || {};

  let done = 0;
  slots.forEach((key) => {
    if (key === "quiz") {
      if (quizResults?.[`quiz_${module.module_id}`]?.passed) done++;
    } else if (events[key]) {
      done++;
    }
  });

  return slots.length > 0 ? done / slots.length : 0;
}

/**
 * Overall course progress fraction 0–1 (scored modules only).
 */
export function courseProgressFraction(courseId, modules, enrollment) {
  const scored = (modules || []).filter((m) =>
    SCORED_MODULE_IDS.includes(m.module_id),
  );
  if (!scored.length) return 0;
  const quizResults = enrollment?.quiz_results || {};
  const sum = scored.reduce(
    (acc, m) => acc + moduleProgressFraction(courseId, m, quizResults),
    0,
  );
  return sum / scored.length;
}

/** True when every scored module is marked complete. */
export function areAllScoredModulesComplete(modules) {
  const scored = (modules || []).filter((m) => SCORED_MODULE_IDS.includes(m.module_id));
  return scored.length > 0 && scored.every((m) => m.completed);
}

/** After completing `moduleId`, would all scored modules be done? */
export function willAllScoredModulesBeComplete(modules, completedModuleIds, moduleId) {
  const completed = new Set([...(completedModuleIds || []), moduleId]);
  const scored = (modules || []).filter((m) => SCORED_MODULE_IDS.includes(m.module_id));
  return scored.length > 0 && scored.every((m) => completed.has(m.module_id));
}
