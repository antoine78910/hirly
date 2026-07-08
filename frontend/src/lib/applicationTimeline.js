import { resolveDisplayStatus } from "./applicationReview";

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
  const company = String(application.job?.company || "").trim().toLowerCase();
  const emailCompany = String(email.company || "").trim().toLowerCase();
  return Boolean(company && emailCompany && company === emailCompany);
}

/** Rich timeline events for application detail (newest first). */
export function buildApplicationTimeline(application, emails = [], t, lang = "en") {
  if (!application) return [];

  const linkedEmails = emails.filter((row) => matchesApplicationEmail(row, application));
  const created = application.created_at;
  const events = [];

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
    const offerEmail = linkedEmails.find((row) => row.category === "offer" || row.filter === "offer");
    events.push({
      key: "offer",
      at: offerEmail?.received_at || offerEmail?.date || application.updated_at || created,
      kind: "offer",
      title: t("tracker.timelineOffer"),
      description: t("tracker.timelineOfferDesc"),
    });
  }

  const submitted =
    resolveDisplayStatus(application) === "submitted"
    || application.submission_status === "submitted"
    || Boolean(application.submitted_at);

  if (submitted) {
    events.push({
      key: "submitted",
      at: application.submitted_at || application.updated_at || created,
      kind: "submitted",
      title: t("tracker.timelineSubmitted"),
      description: t("tracker.timelineSubmittedDesc"),
    });
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

  if (application.package_status && application.package_status !== "not_generated") {
    events.push({
      key: "package",
      at: application.updated_at || created,
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
      const dedupeKey = item.kind === "email" ? item.key : item.kind;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
}

export function filterApplicationEmails(emails = [], application) {
  if (!application) return [];
  return emails.filter((row) => matchesApplicationEmail(row, application));
}
