import { readAiSettings } from "./aiSettings";

const BASE_DOCS = (job) => ({
  tailored_resume: {
    summary: "Tailored CV generated in demo mode (not submitted to employers).",
    highlights: ["Relevant experience highlighted", "Keywords matched to the job description"],
  },
  cover_letter: {
    greeting: `Hi ${job.company} team,`,
    body: `I'm excited about the ${job.title} role at ${job.company}.`,
    closing: "Best regards,\nAlex Martin",
  },
});

function minutesAfter(iso, minutes) {
  const base = Date.parse(iso);
  if (Number.isNaN(base)) return iso;
  return new Date(base + minutes * 60_000).toISOString();
}

/** Demo application created immediately after a right swipe. */
export function buildDemoApplicationFromSwipe(job) {
  const createdAt = new Date().toISOString();
  const reviewOn = readAiSettings().reviewDocuments;
  const docs = BASE_DOCS(job);

  const base = {
    application_id: `demo_local_${Date.now()}_${job.job_id}`,
    job_id: job.job_id,
    job: { ...job },
    demo_local: true,
    match_score: job.match_score,
    match_reasons: job.match_reasons || [],
    package_status: "ready",
    created_at: createdAt,
    package_generated_at: minutesAfter(createdAt, 2),
    ...docs,
  };

  if (reviewOn) {
    return {
      ...base,
      status: "applied",
      submission_status: "prepared",
      user_facing_submission_status: "prepared",
      awaiting_review_at: minutesAfter(createdAt, 3),
    };
  }

  return {
    ...base,
    status: "applied",
    submission_status: "pending",
    user_facing_submission_status: "pending",
    pending_at: minutesAfter(createdAt, 3),
  };
}

/** Seeded showcase rows with varied pipeline stages. */
export function buildDemoShowcaseApplication(job, variantIndex = 0) {
  const createdAt = new Date().toISOString();
  const docs = BASE_DOCS(job);
  const variants = [
    {
      status: "interview",
      submission_status: "submitted",
      user_facing_submission_status: "submitted",
      submitted_at: minutesAfter(createdAt, 8),
      interview_prep: [
        "Walk me through a recent product feature you shipped end-to-end.",
        "How do you balance speed and code quality on a small team?",
      ],
    },
    {
      status: "viewed",
      submission_status: "submitted",
      user_facing_submission_status: "submitted",
      submitted_at: minutesAfter(createdAt, 6),
    },
    {
      status: "applied",
      submission_status: "prepared",
      user_facing_submission_status: "prepared",
      awaiting_review_at: minutesAfter(createdAt, 3),
    },
    {
      status: "applied",
      submission_status: "pending",
      user_facing_submission_status: "pending",
      pending_at: minutesAfter(createdAt, 3),
    },
  ];
  const variant = variants[variantIndex % variants.length];

  return {
    application_id: `demo_local_${Date.now()}_${job.job_id}`,
    job_id: job.job_id,
    job: { ...job },
    demo_local: true,
    match_score: job.match_score,
    match_reasons: job.match_reasons || [],
    package_status: "ready",
    created_at: createdAt,
    package_generated_at: minutesAfter(createdAt, 2),
    ...docs,
    ...variant,
  };
}

export function offsetTimelineIso(baseIso, minutes) {
  return minutesAfter(baseIso, minutes);
}
