/** Display status helpers shared by Tracker and Review. */

export function resolveDisplayStatus({
  status,
  submission_status,
  user_facing_submission_status,
  manual_status,
  admin_status,
}) {
  const values = [
    user_facing_submission_status,
    manual_status,
    admin_status,
    submission_status,
    status,
  ].filter(Boolean);

  if (values.some((v) => ["submitted", "manually_submitted"].includes(v))) return "submitted";
  if (values.some((v) => ["action_required", "needs_user_input"].includes(v))) return "action_required";
  if (values.some((v) => ["pending", "manual_review_needed", "manual_in_progress"].includes(v))) return "pending";
  if (values.some((v) => ["ready", "prepared"].includes(v))) return "prepared";
  if (values.includes("blocked_captcha")) return "blocked_captcha";
  if (values.some((v) => ["prepare_failed", "blocked", "failed"].includes(v))) return "failed";
  if (values.includes("expired")) return "expired";
  if (user_facing_submission_status === "pending") return "pending";
  return "pending";
}

export function isPreparedForDocumentReview(application) {
  if (!application) return false;
  const displayStatus = resolveDisplayStatus(application);
  if (displayStatus !== "prepared") return false;
  return Boolean(
    application.tailored_resume
    || application.cover_letter
    || application.package_status
    || ["ready", "prepared"].includes(application.submission_status),
  );
}

export function filterApplicationsForReview(applications, reviewDocumentsEnabled) {
  if (!reviewDocumentsEnabled) return [];
  return (applications || []).filter(isPreparedForDocumentReview);
}
