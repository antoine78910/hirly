const SWIPE_ATS_OVERLAY_HIDDEN_EMAILS = new Set(["anto.delbos@gmail.com"]);

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function isSwipeAtsOverlayHiddenForEmail(email) {
  return SWIPE_ATS_OVERLAY_HIDDEN_EMAILS.has(normalizeEmail(email));
}

/** Admin-only ATS tier overlay on swipe cards — hidden for specific accounts. */
export function shouldShowSwipeAdminAtsBadge(isAdmin, email) {
  if (!isAdmin) return false;
  const normalized = normalizeEmail(email);
  // Avoid flashing the overlay before /auth/me resolves the email.
  if (!normalized) return false;
  return !isSwipeAtsOverlayHiddenForEmail(normalized);
}

/** Hide smartrecruiters / greenhouse cards on personal swipe feeds (filming). */
export function filterPersonalSwipeFeedJobs(email, jobs) {
  if (!isSwipeAtsOverlayHiddenForEmail(email)) return jobs || [];
  const hiddenAts = new Set(["smartrecruiters", "greenhouse"]);
  return (jobs || []).filter((job) => {
    const ats = String(job?.ats_provider || job?.provider || "")
      .trim()
      .toLowerCase();
    return !hiddenAts.has(ats);
  });
}
