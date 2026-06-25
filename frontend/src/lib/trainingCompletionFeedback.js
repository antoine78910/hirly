const PENDING_KEY = "hirly.training.completion.feedback.pending";
const SEEN_PREFIX = "hirly.training.completion.feedback.seen.";

export function queueTrainingCompletionFeedback(courseId) {
  if (typeof window === "undefined" || !courseId) return;
  sessionStorage.setItem(PENDING_KEY, String(courseId));
}

export function shouldShowTrainingCompletionFeedback(courseId, userId) {
  if (typeof window === "undefined" || !courseId) return false;
  const force = new URLSearchParams(window.location.search).get("trainingFeedback") === "1";
  if (force) return true;
  const pending = sessionStorage.getItem(PENDING_KEY);
  if (pending !== String(courseId)) return false;
  if (userId && localStorage.getItem(`${SEEN_PREFIX}${userId}.${courseId}`) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    return false;
  }
  return true;
}

export function dismissTrainingCompletionFeedback(courseId, userId, { submitted = false } = {}) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_KEY);
  if (submitted && userId && courseId) {
    localStorage.setItem(`${SEEN_PREFIX}${userId}.${courseId}`, "1");
  }
}

export function resetTrainingCompletionFeedbackForTesting(courseId, userId) {
  queueTrainingCompletionFeedback(courseId);
  if (userId && typeof window !== "undefined") {
    localStorage.removeItem(`${SEEN_PREFIX}${userId}.${courseId}`);
  }
}
