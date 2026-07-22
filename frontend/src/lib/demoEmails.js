import { getMergedTrackerApplications } from "./demoApplications";
import { isDemoAccountEnabled } from "./demoAccount";
import { isFinanceDemoEnabled } from "./demoSettings";
import { ensureDemoScreenshotData } from "./demoScreenshotSeed";

function daysAgoIso(days, hours = 0) {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
}

function buildMessage({
  id,
  application,
  filter,
  category,
  from,
  subject,
  preview,
  body,
  receivedAt,
}) {
  const job = application?.job || {};
  return {
    id,
    application_id: application?.application_id || null,
    job_id: application?.job_id || job.job_id || null,
    company: job.company || application?.company || "",
    job_title: job.title || application?.title || "",
    from,
    to: "alex.martin@gmail.com",
    subject,
    preview,
    body: body || preview,
    date: receivedAt,
    received_at: receivedAt,
    filter,
    category: category || filter,
    provider: "gmail",
  };
}

function welcomeMessage() {
  const receivedAt = daysAgoIso(14, 2);
  return {
    id: "demo_welcome",
    variant: "welcome",
    category: "system",
    filter: "primary",
    from: "Hirly",
    to: "alex.martin@gmail.com",
    subject: "Welcome to your Hirly inbox",
    preview: "Recruiter replies from your applications will appear here automatically.",
    body: "Recruiter replies from your applications will appear here automatically. Connect Gmail anytime to sync real messages — demo mode shows sample replies for filming.",
    date: receivedAt,
    received_at: receivedAt,
    replyDisabled: true,
    provider: "demo",
  };
}

function messagesForApplication(app) {
  if (!app?.application_id) return [];
  const job = app.job || {};
  const company = job.company || "Company";
  const title = job.title || "Role";
  const base = app.created_at || daysAgoIso(5);
  const messages = [];

  const submitted =
    app.submission_status === "submitted" ||
    app.user_facing_submission_status === "submitted" ||
    app.status === "viewed";

  if (submitted || app.status === "interview" || app.status === "offer") {
    messages.push(
      buildMessage({
        id: `demo_email_confirm_${app.application_id}`,
        application: app,
        filter: "primary",
        category: "primary",
        from: `talent@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        subject: `Application received — ${title}`,
        preview: `Thank you for applying to the ${title} role at ${company}. Our team is reviewing your profile.`,
        body: `Hi Alex,\n\nThank you for applying to the ${title} position at ${company}. We have received your application and our recruiting team will review it shortly.\n\nBest regards,\n${company} Talent Team`,
        receivedAt: daysAgoIso(4, 3),
      }),
    );
  }

  if (app.status === "interview" || app.status === "offer") {
    messages.push(
      buildMessage({
        id: `demo_email_interview_${app.application_id}`,
        application: app,
        filter: "interview",
        category: "interview",
        from: `recruiting@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        subject: `Interview invitation — ${title}`,
        preview: `We'd like to invite you to a 30-minute video interview for the ${title} role.`,
        body: `Hi Alex,\n\nCongratulations! We would like to invite you to a first interview for the ${title} position at ${company}.\n\nPlease reply with your availability this week.\n\nBest,\n${company} Recruiting`,
        receivedAt: daysAgoIso(2, 5),
      }),
    );
  }

  if (app.status === "offer") {
    messages.push(
      buildMessage({
        id: `demo_email_offer_${app.application_id}`,
        application: app,
        filter: "offer",
        category: "offer",
        from: `hr@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        subject: `Offer — ${title} at ${company}`,
        preview: `We are pleased to extend an offer for the ${title} role. Please find the details attached.`,
        body: `Hi Alex,\n\nWe are delighted to offer you the ${title} position at ${company}. Your experience and motivation stood out throughout the process.\n\nWe will send the formal offer letter separately.\n\nCongratulations!\n${company} HR`,
        receivedAt: daysAgoIso(1, 1),
      }),
    );
  }

  if (app.submission_status === "action_required" || app.status === "blocked") {
    messages.push(
      buildMessage({
        id: `demo_email_verify_${app.application_id}`,
        application: app,
        filter: "verification",
        category: "verification",
        from: "security@greenhouse.io",
        subject: `Verify your email — ${company}`,
        preview: "Please confirm your email address to complete your application.",
        body: "Please click the link in this email to verify your address and finish submitting your application.",
        receivedAt: daysAgoIso(3, 8),
      }),
    );
  }

  // Fallback primary thread for in-progress applications
  if (!messages.length) {
    messages.push(
      buildMessage({
        id: `demo_email_progress_${app.application_id}`,
        application: app,
        filter: "primary",
        category: "primary",
        from: `noreply@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        subject: `Your application for ${title}`,
        preview: `We're preparing your application package for ${company}.`,
        receivedAt: base,
      }),
    );
  }

  return messages;
}

/** Static extras so inbox tabs always look populated even before swipes. */
function staticShowcaseMessages(apps) {
  const byCompany = (needle) =>
    apps.find((app) =>
      String(app.job?.company || "")
        .toLowerCase()
        .includes(needle),
    );

  const extras = [];
  const sg = byCompany("société") || byCompany("socgen") || byCompany("generale");
  const natixis = byCompany("natixis");
  const cacib = byCompany("crédit agricole") || byCompany("credit agricole");

  if (!sg) {
    extras.push(
      buildMessage({
        id: "demo_static_interview_sg",
        application: {
          application_id: "demo_static_sg",
          job_id: "demo_static_sg",
          job: {
            company: "Société Générale",
            title: "Analyste Risques de Marché",
            job_id: "demo_static_sg",
          },
          status: "interview",
          submission_status: "submitted",
        },
        filter: "interview",
        category: "interview",
        from: "recruiting@socgen.com",
        subject: "Interview invitation — Analyste Risques de Marché",
        preview: "We'd like to schedule a 30-minute call with our markets team this week.",
        receivedAt: daysAgoIso(2, 4),
      }),
    );
  }

  if (!natixis) {
    extras.push(
      buildMessage({
        id: "demo_static_offer_natixis",
        application: {
          application_id: "demo_static_natixis",
          job_id: "demo_static_natixis",
          job: { company: "Natixis", title: "Quantitative Analyst", job_id: "demo_static_natixis" },
          status: "offer",
          submission_status: "submitted",
        },
        filter: "offer",
        category: "offer",
        from: "hr@natixis.com",
        subject: "Offer — Quantitative Analyst",
        preview:
          "Congratulations! We are pleased to extend an offer for the Quantitative Analyst role.",
        receivedAt: daysAgoIso(1, 2),
      }),
    );
  }

  if (!cacib) {
    extras.push(
      buildMessage({
        id: "demo_static_verify_cacib",
        application: {
          application_id: "demo_static_cacib",
          job_id: "demo_static_cacib",
          job: {
            company: "Crédit Agricole CIB",
            title: "Analyste DCM",
            job_id: "demo_static_cacib",
          },
          status: "applied",
          submission_status: "action_required",
        },
        filter: "verification",
        category: "verification",
        from: "security@greenhouse.io",
        subject: "Verify your email — Crédit Agricole CIB",
        preview: "Please confirm your email to complete your application on Greenhouse.",
        receivedAt: daysAgoIso(3, 6),
      }),
    );
  }

  return extras;
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    if (a.variant === "welcome") return 1;
    if (b.variant === "welcome") return -1;
    const aTime = Date.parse(a.received_at || a.date || 0) || 0;
    const bTime = Date.parse(b.received_at || b.date || 0) || 0;
    return bTime - aTime;
  });
}

/** Ensure showcase applications exist, then build inbox payload for demo modes. */
export function buildDemoInboxPayload() {
  ensureDemoScreenshotData();

  const apps = getMergedTrackerApplications([]);
  const dynamic = apps.flatMap(messagesForApplication);
  const staticExtras = staticShowcaseMessages(apps);
  const seen = new Set();
  const merged = [];

  for (const row of [...dynamic, ...staticExtras]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }

  return {
    messages: sortMessages([welcomeMessage(), ...merged]),
    gmail: {
      connected: true,
      email: "alex.martin@gmail.com",
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    },
    sync: { ok: true, skipped: true, demo: true },
  };
}

export function isDemoInboxMode() {
  return isDemoAccountEnabled() || isFinanceDemoEnabled();
}
