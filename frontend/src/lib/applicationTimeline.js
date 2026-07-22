import { resolveDisplayStatus } from "./applicationReview";
import { readAiSettings } from "./aiSettings";
import { readNotificationSettings } from "./notificationSettings";
import { hasApplicationDocuments } from "./applicationDocuments";

export function formatTimelineDateTime(iso, lang = "en") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimelineDate(iso, lang = "en") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function matchesApplicationEmail(email, application) {
  if (!email || !application) return false;
  if (email.application_id && email.application_id === application.application_id) return true;
  if (email.job_id && email.job_id === application.job_id) return true;
  const company = String(application.job?.company || "")
    .trim()
    .toLowerCase();
  const emailCompany = String(email.company || "")
    .trim()
    .toLowerCase();
  return Boolean(company && emailCompany && company === emailCompany);
}

function offsetIso(baseIso, minutesAfter) {
  const base = Date.parse(baseIso);
  if (Number.isNaN(base)) return baseIso;
  return new Date(base + minutesAfter * 60_000).toISOString();
}

function hasGeneratedPackage(application) {
  return Boolean(
    (application.package_status && application.package_status !== "not_generated") ||
      hasApplicationDocuments(application),
  );
}

/** Rich timeline events for application detail (newest first). */
export function buildApplicationTimeline(application, emails = [], t, lang = "en") {
  if (!application) return [];

  const linkedEmails = emails.filter((row) => matchesApplicationEmail(row, application));
  const created = application.created_at;
  const events = [];
  const aiSettings = typeof window !== "undefined" ? readAiSettings() : { reviewDocuments: true };
  const notificationSettings = typeof window !== "undefined" ? readNotificationSettings() : {};
  const submission = application.submission_status;
  const displayStatus = resolveDisplayStatus(application);

  if (application.status === "interview" || application.status === "offer") {
    const interviewEmail = linkedEmails.find(
      (row) => row.category === "interview" || row.filter === "interview",
    );
    events.push({
      key: "interview",
      at: interviewEmail?.received_at || interviewEmail?.date || application.updated_at || created,
      kind: "interview",
      title: t("tracker.timelineInterview"),
      description: t("tracker.timelineInterviewDesc"),
    });
  }

  if (application.status === "offer") {
    const offerEmail = linkedEmails.find(
      (row) => row.category === "offer" || row.filter === "offer",
    );
    events.push({
      key: "offer",
      at: offerEmail?.received_at || offerEmail?.date || application.updated_at || created,
      kind: "offer",
      title: t("tracker.timelineOffer"),
      description: t("tracker.timelineOfferDesc"),
    });
  }

  const submitted =
    displayStatus === "submitted" ||
    submission === "submitted" ||
    Boolean(application.submitted_at);

  if (submitted) {
    events.push({
      key: "submitted",
      at: application.submitted_at || application.updated_at || offsetIso(created, 5),
      kind: "submitted",
      title: t("tracker.timelineSubmitted"),
      description: t("tracker.timelineSubmittedDesc"),
    });

    if (notificationSettings.applicationSubmitted !== false) {
      events.push({
        key: "notification-submitted",
        at: application.notification_sent_at || offsetIso(application.submitted_at || created, 1),
        kind: "notification",
        title: t("tracker.timelineNotificationSent"),
        description: t("tracker.timelineNotificationSentDesc"),
      });
    }
  }

  for (const email of linkedEmails) {
    events.push({
      key: `email-${email.id}`,
      at: email.received_at || email.date || created,
      kind: "email",
      title: t("tracker.timelineEmailReceived"),
      description: t("tracker.timelineEmailReceivedDesc"),
      email,
    });
  }

  if (submission === "failed" || displayStatus === "failed") {
    events.push({
      key: "failed",
      at: application.updated_at || offsetIso(created, 4),
      kind: "failed",
      title: t("tracker.timelineFailed"),
      description: t("tracker.timelineFailedDesc"),
    });
  }

  if (submission === "expired" || displayStatus === "expired") {
    events.push({
      key: "expired",
      at: application.updated_at || offsetIso(created, 4),
      kind: "expired",
      title: t("tracker.timelineExpired"),
      description: t("tracker.timelineExpiredDesc"),
    });
  }

  if (submission === "prepare_failed") {
    events.push({
      key: "prepare-failed",
      at: application.updated_at || offsetIso(created, 4),
      kind: "failed",
      title: t("tracker.timelineFailed"),
      description: t("tracker.timelinePrepareFailedDesc"),
    });
  }

  if (submission === "blocked_captcha" || displayStatus === "blocked_captcha") {
    events.push({
      key: "security",
      at: application.updated_at || offsetIso(created, 4),
      kind: "security",
      title: t("tracker.timelineSecurity"),
      description: t("tracker.timelineSecurityDesc"),
    });

    if (notificationSettings.verificationRequired !== false) {
      events.push({
        key: "notification-verification",
        at: offsetIso(application.updated_at || created, 1),
        kind: "notification",
        title: t("tracker.timelineVerificationNotification"),
        description: t("tracker.timelineVerificationNotificationDesc"),
      });
    }
  }

  if (
    submission === "action_required" ||
    submission === "blocked" ||
    displayStatus === "action_required"
  ) {
    events.push({
      key: "action-required",
      at: application.updated_at || offsetIso(created, 4),
      kind: "action_required",
      title: t("tracker.timelineAnswersNeeded"),
      description: t("tracker.timelineAnswersNeededDesc"),
    });
  }

  if (submission === "pending" || displayStatus === "pending") {
    events.push({
      key: "pending",
      at: application.pending_at || application.updated_at || offsetIso(created, 3),
      kind: "pending",
      title: t("tracker.timelinePending"),
      description: t("tracker.timelinePendingDesc"),
    });
  }

  if (
    hasApplicationDocuments(application) &&
    aiSettings.reviewDocuments &&
    !submitted &&
    application.document_review_status !== "approved" &&
    (application.document_review_status === "awaiting_user" ||
      submission === "prepared" ||
      submission === "ready" ||
      application.generation_status === "generated")
  ) {
    events.push({
      key: "awaiting-review",
      at: application.awaiting_review_at || application.updated_at || offsetIso(created, 3),
      kind: "review",
      title: t("tracker.timelineAwaitingReview"),
      description: t("tracker.timelineAwaitingReviewDesc"),
    });
  } else if (
    (submission === "prepared" || submission === "ready") &&
    !aiSettings.reviewDocuments &&
    !submitted &&
    submission !== "pending"
  ) {
    events.push({
      key: "prepared",
      at: application.updated_at || offsetIso(created, 3),
      kind: "prepared",
      title: t("tracker.timelinePrepared"),
      description: t("tracker.timelinePreparedDesc"),
    });
  }

  if (hasGeneratedPackage(application)) {
    events.push({
      key: "package",
      at: application.package_generated_at || application.updated_at || offsetIso(created, 2),
      kind: "package",
      title: t("tracker.timelinePackage"),
      description: t("tracker.timelinePackageDesc"),
    });
  }

  events.push({
    key: "created",
    at: created,
    kind: "created",
    title: t("tracker.timelineCreated"),
    description: t("tracker.timelineCreatedDesc"),
  });

  const seen = new Set();
  return events
    .filter((item) => item.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((item) => {
      const dedupeKey =
        item.kind === "email" || item.kind === "notification" ? item.key : item.kind;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
}

export function filterApplicationEmails(emails = [], application) {
  if (!application) return [];
  return emails.filter((row) => matchesApplicationEmail(row, application));
}
