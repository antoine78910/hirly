const PENDING_KEY = "hirly.training.completion.feedback.pending";
const SEEN_PREFIX = "hirly.training.completion.feedback.seen.";
const DISMISSED_SESSION_PREFIX = "hirly.training.completion.feedback.dismissed.";

export function queueTrainingCompletionFeedback(courseId) {
  if (typeof window === "undefined" || !courseId) return;
  sessionStorage.setItem(PENDING_KEY, String(courseId));
}

export function shouldShowTrainingCompletionFeedback(courseId, userId, { atFullProgress = false } = {}) {
  if (typeof window === "undefined" || !courseId) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get("trainingFeedback") === "1" || params.get("trainingComplete") === "1") {
    return true;
  }

  if (userId && localStorage.getItem(`${SEEN_PREFIX}${userId}.${courseId}`) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    return false;
  }

  if (userId && sessionStorage.getItem(`${DISMISSED_SESSION_PREFIX}${userId}.${courseId}`) === "1") {
    return false;
  }

  const pending = sessionStorage.getItem(PENDING_KEY);
  if (pending === String(courseId)) return true;
  if (atFullProgress) return true;
  return false;
}

export function dismissTrainingCompletionFeedback(courseId, userId, { submitted = false } = {}) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_KEY);
  if (submitted && userId && courseId) {
    localStorage.setItem(`${SEEN_PREFIX}${userId}.${courseId}`, "1");
    sessionStorage.removeItem(`${DISMISSED_SESSION_PREFIX}${userId}.${courseId}`);
    return;
  }
  if (userId && courseId) {
    sessionStorage.setItem(`${DISMISSED_SESSION_PREFIX}${userId}.${courseId}`, "1");
  }
}

export function resetTrainingCompletionFeedbackForTesting(courseId, userId) {
  queueTrainingCompletionFeedback(courseId);
  if (userId && typeof window !== "undefined") {
    localStorage.removeItem(`${SEEN_PREFIX}${userId}.${courseId}`);
    sessionStorage.removeItem(`${DISMISSED_SESSION_PREFIX}${userId}.${courseId}`);
  }
}
