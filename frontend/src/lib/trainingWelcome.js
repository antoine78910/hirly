const PENDING_KEY = "hirly.training.welcome.pending";
const SEEN_PREFIX = "hirly.training.welcome.seen.";

export function queueTrainingWelcome() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PENDING_KEY, "1");
}

export function shouldOpenTrainingWelcome(userId) {
  if (typeof window === "undefined") return false;
  const force = new URLSearchParams(window.location.search).get("trainingWelcome") === "1";
  if (force) return true;
  if (sessionStorage.getItem(PENDING_KEY) !== "1") return false;
  if (userId && localStorage.getItem(`${SEEN_PREFIX}${userId}`) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    return false;
  }
  return true;
}

export function dismissTrainingWelcome(userId) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_KEY);
  if (userId) {
    localStorage.setItem(`${SEEN_PREFIX}${userId}`, "1");
  }
}

export function resetTrainingWelcomeForTesting(userId) {
  queueTrainingWelcome();
  if (userId && typeof window !== "undefined") {
    localStorage.removeItem(`${SEEN_PREFIX}${userId}`);
  }
}
