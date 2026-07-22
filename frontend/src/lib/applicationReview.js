/** Display status helpers shared by Tracker and Review. */

import { hasApplicationDocuments, isApplicationGenerating } from "./applicationDocuments";

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

  // Terminal expiry must override older generic status fields such as `pending`.
  if (
    user_facing_submission_status === "expired" ||
    submission_status === "expired" ||
    manual_status === "offer_expired" ||
    admin_status === "offer_expired"
  )
    return "expired";
  if (values.some((v) => ["submitted", "manually_submitted"].includes(v))) return "submitted";
  if (values.some((v) => ["action_required", "needs_user_input"].includes(v)))
    return "action_required";
  // Security / bot walls must win over remapped `pending` so users see the CTA.
  if (values.includes("blocked_captcha")) return "blocked_captcha";
  if (values.some((v) => ["prepare_failed", "blocked", "failed"].includes(v))) return "failed";
  if (values.some((v) => ["pending", "manual_review_needed", "manual_in_progress"].includes(v)))
    return "pending";
  if (values.some((v) => ["ready", "prepared"].includes(v))) return "prepared";
  if (user_facing_submission_status === "pending") return "pending";
  return "pending";
}

function isApplicationSubmitted(application) {
  const displayStatus = resolveDisplayStatus(application);
  return (
    displayStatus === "submitted" ||
    application?.submission_status === "submitted" ||
    application?.submission_status === "manually_submitted"
  );
}

export function isAwaitingUserDocumentReview(application) {
  if (!application) return false;
  if (application.document_review_status === "approved") return false;
  if (isApplicationSubmitted(application)) return false;
  if (isApplicationGenerating(application)) return false;
  if (!hasApplicationDocuments(application)) return false;

  if (application.document_review_status === "awaiting_user") return true;

  const displayStatus = resolveDisplayStatus(application);
  if (displayStatus === "prepared") return true;
  if (application.user_facing_submission_status === "prepared") return true;
  if (["prepared", "ready"].includes(application.submission_status)) return true;

  const packageReady =
    application.generation_status === "generated" ||
    (application.package_status &&
      !["not_generated", "pending_generation", "failed"].includes(application.package_status));
  return Boolean(packageReady && application.submission_status === "not_submitted");
}

export function isPreparedForDocumentReview(application) {
  return isAwaitingUserDocumentReview(application);
}

export function filterApplicationsForReview(applications, reviewDocumentsEnabled) {
  if (!reviewDocumentsEnabled) return [];
  return (applications || []).filter(isAwaitingUserDocumentReview).sort((a, b) => {
    const aTime = Date.parse(a.awaiting_review_at || a.updated_at || a.created_at || 0);
    const bTime = Date.parse(b.awaiting_review_at || b.updated_at || b.created_at || 0);
    return bTime - aTime;
  });
}
