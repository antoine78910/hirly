const PENDING_KEY = "hirly.demo.welcome.pending";
const SEEN_PREFIX = "hirly.demo.welcome.seen.";

export function queueDemoWelcome() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PENDING_KEY, "1");
}

export function shouldOpenDemoWelcome(userId) {
  if (typeof window === "undefined") return false;
  const force = new URLSearchParams(window.location.search).get("demoWelcome") === "1";
  if (force) return true;
  if (sessionStorage.getItem(PENDING_KEY) !== "1") return false;
  if (userId && localStorage.getItem(`${SEEN_PREFIX}${userId}`) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    return false;
  }
  return true;
}

export function dismissDemoWelcome(userId) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_KEY);
  if (userId) {
    localStorage.setItem(`${SEEN_PREFIX}${userId}`, "1");
  }
}

/** Dev / QA: show the demo welcome modal again on next visit to /swipe */
export function resetDemoWelcomeForTesting(userId) {
  queueDemoWelcome();
  if (userId && typeof window !== "undefined") {
    localStorage.removeItem(`${SEEN_PREFIX}${userId}`);
  }
}
