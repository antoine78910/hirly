const daysAgoIso = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

const section = (title, bullets) => ({ title, bullets });

function job({
  job_id,
  title,
  company,
  location,
  remote = "hybrid",
  seniority = "mid",
  salary_min,
  salary_max,
  match_score,
  match_reasons,
  description,
  tech_stack,
  postedDaysAgo = 3,
}) {
  return {
    job_id,
    title,
    company,
    location,
    remote,
    seniority,
    salary_min,
    salary_max,
    match_score,
    match_reasons,
    tech_stack,
    posted_at: daysAgoIso(postedDaysAgo),
    auto_apply_supported: true,
    provider: "demo",
    description,
    clean_description: description,
    job_description_sections: [
      section("About the role", [
        description,
        `Join ${company} and help ship product used by thousands of teams every day.`,
      ]),
      section("What you'll do", [
        "Own features end-to-end from design review to production.",
        "Collaborate with design and backend on polished user experiences.",
        "Improve performance, accessibility, and developer experience.",
      ]),
      section("What we're looking for", [
        `Strong experience with ${(tech_stack || []).slice(0, 2).join(" and ")}.`,
        "Clear communication and bias for action in a small team.",
        "Portfolio or shipped work you can walk us through.",
      ]),
    ],
  };
}

export const DEMO_JOBS = [
  job({
    job_id: "demo_job_linear",
    title: "Senior Frontend Engineer",
    company: "Linear",
    location: "Remote (Global)",
    remote: "remote",
    seniority: "senior",
    salary_min: 140_000,
    salary_max: 200_000,
    match_score: 94,
    match_reasons: [
      "React + TypeScript match your stack",
      "Remote-friendly",
      "Strong product culture",
    ],
    tech_stack: ["TypeScript", "React", "GraphQL"],
    description:
      "Build the world's fastest issue tracker. Work on performance, animations, and complex UI state.",
  }),
  job({
    job_id: "demo_job_vercel",
    title: "Full Stack Engineer",
    company: "Vercel",
    location: "San Francisco, CA",
    remote: "hybrid",
    seniority: "mid",
    salary_min: 160_000,
    salary_max: 240_000,
    match_score: 91,
    match_reasons: ["Next.js experience aligns well", "DX-focused team", "Hybrid option in SF"],
    tech_stack: ["TypeScript", "Next.js", "Node.js"],
    description:
      "Ship Next.js, Edge runtime, and developer-experience tools used by millions of developers.",
    postedDaysAgo: 1,
  }),
  job({
    job_id: "demo_job_anthropic",
    title: "Product Engineer",
    company: "Anthropic",
    location: "San Francisco, CA",
    remote: "onsite",
    seniority: "senior",
    salary_min: 220_000,
    salary_max: 380_000,
    match_score: 88,
    match_reasons: ["AI product surface area", "High-impact role", "Top-tier compensation"],
    tech_stack: ["Python", "React", "TypeScript"],
    description:
      "Work on Claude product surfaces — ship features that make AI safe and useful at scale.",
    postedDaysAgo: 5,
  }),
  job({
    job_id: "demo_job_raycast",
    title: "Product Designer",
    company: "Raycast",
    location: "Remote (EU/US)",
    remote: "remote",
    seniority: "senior",
    salary_min: 120_000,
    salary_max: 180_000,
    match_score: 86,
    match_reasons: ["Design + eng crossover", "Mac-native product", "Fully remote"],
    tech_stack: ["Figma", "Framer", "Prototyping"],
    description: "Design extensions and core surfaces for the fastest launcher on Mac.",
    postedDaysAgo: 2,
  }),
  job({
    job_id: "demo_job_supabase",
    title: "Backend Engineer",
    company: "Supabase",
    location: "Remote (Global)",
    remote: "remote",
    seniority: "mid",
    salary_min: 130_000,
    salary_max: 190_000,
    match_score: 85,
    match_reasons: ["Postgres + TypeScript stack", "Open-source culture", "Global remote"],
    tech_stack: ["TypeScript", "Postgres", "Go"],
    description:
      "Build the open-source Firebase alternative — Postgres, realtime, auth, edge functions.",
    postedDaysAgo: 7,
  }),
  job({
    job_id: "demo_job_notion",
    title: "iOS Engineer",
    company: "Notion",
    location: "New York, NY",
    remote: "hybrid",
    seniority: "senior",
    salary_min: 150_000,
    salary_max: 230_000,
    match_score: 82,
    match_reasons: ["Mobile craft at scale", "Hybrid NYC", "Well-known brand"],
    tech_stack: ["Swift", "SwiftUI"],
    description: "Build the Notion mobile experience used by millions of users worldwide.",
    postedDaysAgo: 4,
  }),
  job({
    job_id: "demo_job_stripe",
    title: "DevRel Engineer",
    company: "Stripe",
    location: "Remote (US)",
    remote: "remote",
    seniority: "senior",
    salary_min: 140_000,
    salary_max: 210_000,
    match_score: 80,
    match_reasons: ["Developer-facing role", "Strong writing + code", "Remote US"],
    tech_stack: ["TypeScript", "React", "Node.js"],
    description:
      "Build demos, content, and tooling that helps developers integrate Stripe in minutes.",
    postedDaysAgo: 6,
  }),
  job({
    job_id: "demo_job_framer",
    title: "Junior Frontend Developer",
    company: "Framer",
    location: "Amsterdam, NL",
    remote: "hybrid",
    seniority: "junior",
    salary_min: 60_000,
    salary_max: 85_000,
    match_score: 77,
    match_reasons: ["Great for portfolio growth", "Design-led product", "EU hub"],
    tech_stack: ["React", "TypeScript", "CSS"],
    description: "Join the team building the no-code site builder loved by designers.",
    postedDaysAgo: 8,
  }),
];

import { EXAMPLE_RESUME } from "./exampleResume";

export const DEMO_PROFILE = {
  target_role: EXAMPLE_RESUME.target_role,
  target_roles: EXAMPLE_RESUME.target_roles,
  target_location: EXAMPLE_RESUME.target_location,
  target_location_data: EXAMPLE_RESUME.target_location_data,
  remote_preference: EXAMPLE_RESUME.remote_preference,
  seniority: EXAMPLE_RESUME.seniority,
  template_style: EXAMPLE_RESUME.template_style,
  contact: { ...EXAMPLE_RESUME.contact },
  extras: {
    onboarding: {
      onboarding_location: EXAMPLE_RESUME.target_location,
      salary_min: 32_000,
      salary_max: 45_000,
    },
  },
  skills: [...EXAMPLE_RESUME.skills],
  experience: EXAMPLE_RESUME.experience.map(({ role, company, duration }) => ({
    role,
    company,
    years: duration,
  })),
  cv_text: EXAMPLE_RESUME.cv_text,
  cv_filename: EXAMPLE_RESUME.cv_filename,
  cv_mime: EXAMPLE_RESUME.cv_mime,
  cv_preview_url: EXAMPLE_RESUME.previewUrl,
  additional_documents: [
    {
      id: "demo-doc-1",
      name: "Portfolio.pdf",
      mime: "application/pdf",
      uploaded_at: "2026-06-19T10:00:00.000Z",
      size: 245_000,
    },
  ],
};

function application({
  application_id,
  job,
  status,
  submission_status = "not_submitted",
  match_score,
  match_reasons,
  createdDaysAgo = 2,
}) {
  return {
    application_id,
    job_id: job.job_id,
    job,
    status,
    submission_status,
    match_score,
    match_reasons,
    created_at: daysAgoIso(createdDaysAgo),
    tailored_resume: {
      summary:
        "Product-focused frontend engineer with a track record of shipping fast, accessible UI.",
      highlights: ["Led design system rollout", "Reduced bundle size by 38%", "Mentored 2 juniors"],
    },
    cover_letter: {
      greeting: `Hi ${job.company} team,`,
      body: `I'm excited about the ${job.title} role. My experience with ${(job.tech_stack || []).slice(0, 2).join(" and ")} maps directly to what you're building.`,
      closing: "Best,\nAlex Martin",
    },
  };
}

export const DEMO_APPLICATIONS = [
  application({
    application_id: "demo_app_1",
    job: DEMO_JOBS[0],
    status: "interview",
    submission_status: "submitted",
    match_score: 94,
    match_reasons: DEMO_JOBS[0].match_reasons,
    createdDaysAgo: 1,
  }),
  application({
    application_id: "demo_app_2",
    job: DEMO_JOBS[1],
    status: "viewed",
    submission_status: "ready",
    match_score: 91,
    match_reasons: DEMO_JOBS[1].match_reasons,
    createdDaysAgo: 3,
  }),
  application({
    application_id: "demo_app_3",
    job: DEMO_JOBS[2],
    status: "applied",
    submission_status: "not_submitted",
    match_score: 88,
    match_reasons: DEMO_JOBS[2].match_reasons,
    createdDaysAgo: 5,
  }),
  application({
    application_id: "demo_app_4",
    job: DEMO_JOBS[3],
    status: "offer",
    submission_status: "submitted",
    match_score: 86,
    match_reasons: DEMO_JOBS[3].match_reasons,
    createdDaysAgo: 8,
  }),
  application({
    application_id: "demo_app_5",
    job: DEMO_JOBS[4],
    status: "rejected",
    submission_status: "submitted",
    match_score: 85,
    match_reasons: DEMO_JOBS[4].match_reasons,
    createdDaysAgo: 12,
  }),
];

export const DEMO_INTERVIEW_PREP = {
  likely_questions: [
    {
      category: "Behavioral",
      q: "Tell me about a time you shipped under a tight deadline.",
      why: "Tests prioritization and communication under pressure.",
    },
    {
      category: "Technical",
      q: "How would you structure state in a complex React dashboard?",
      why: "Probes frontend architecture instincts.",
    },
    {
      category: "System Design",
      q: "Design a job feed that stays fast with millions of listings.",
      why: "Checks scalability thinking for Swiipr-like products.",
    },
    {
      category: "Role-fit",
      q: "Why frontend engineering at a product-led company?",
      why: "Validates motivation and craft alignment.",
    },
    {
      category: "Behavioral",
      q: "Describe feedback that changed how you build UI.",
      why: "Looks for growth mindset and collaboration.",
    },
    {
      category: "Technical",
      q: "Walk me through improving LCP on a marketing site.",
      why: "Performance is core to senior frontend roles.",
    },
  ],
  tips: [
    "Lead with metrics: users impacted, latency saved, revenue moved.",
    "Keep answers under 90 seconds — signpost, story, result.",
    "Mirror the job description language in 2–3 examples.",
    "Prepare one failure story with a clear lesson learned.",
    "Ask about team rituals, design-dev handoff, and release cadence.",
  ],
  mock_questions: [
    "Tell me about yourself and why you're targeting this role.",
    "Describe a feature you owned from idea to launch.",
    "How do you balance speed vs. quality on the frontend?",
    "What's your approach to code review and mentoring?",
    "Why do you want to join us specifically?",
  ],
};

export const DEMO_STREAK = {
  streak: 4,
  sessions_total: 12,
  sessions_week: 3,
  best: 87,
};

export const DEMO_IMPROVE = {
  recruiter_view: {
    summary:
      "Recruiters see a strong product engineer profile with modern frontend skills and clear ownership stories. Adding more quantified impact and system-design depth would push you into the top tier for senior roles.",
    score: 78,
    label: "Solid",
  },
  tips: [
    "Add 2–3 bullet metrics per role on your CV.",
    "Highlight one cross-functional leadership example.",
    "Pin a flagship project with a live demo link.",
    "Tighten your headline to match target seniority.",
  ],
  resume_tips: [
    {
      title: "Quantify every bullet",
      detail: "Replace 'improved performance' with 'cut LCP from 3.2s to 1.4s on mobile'.",
    },
    {
      title: "Lead with outcomes",
      detail: "Start bullets with impact, then mention the stack you used.",
    },
    {
      title: "Show design partnership",
      detail: "Add one line on how you work with Figma and design systems.",
    },
    {
      title: "Trim early roles",
      detail: "Keep internships to 2 bullets max — save space for recent wins.",
    },
  ],
  skill_gaps: [
    {
      skill: "System design storytelling",
      why: "Senior loops often include architecture whiteboards.",
      impact: "high",
    },
    {
      skill: "Web performance tooling",
      why: "Core Web Vitals fluency signals senior frontend depth.",
      impact: "medium",
    },
    {
      skill: "GraphQL at scale",
      why: "Several target companies list GraphQL in their stack.",
      impact: "medium",
    },
    {
      skill: "Public writing / talks",
      why: "DevRel-adjacent roles reward visible thought leadership.",
      impact: "low",
    },
  ],
  certifications: [
    {
      name: "Frontend Masters — Advanced React",
      provider: "Frontend Masters",
      why: "Signals depth on patterns interviewers ask about.",
      duration: "2 weeks",
    },
    {
      name: "AWS Cloud Practitioner",
      provider: "AWS",
      why: "Useful baseline for full-stack product teams.",
      duration: "3 weeks",
    },
    {
      name: "Google UX Design Certificate",
      provider: "Coursera",
      why: "Supports product-designer crossover narratives.",
      duration: "6 weeks",
    },
  ],
};

export const DEMO_INTERVIEW_SCORE = {
  confidence: 81,
  communication: 84,
  technical: 76,
  overall: 82,
  headline: "Clear communicator — deepen technical examples",
  strengths: [
    "Structured answers with a clear beginning, middle, and result",
    "Enthusiasm for the product without sounding generic",
    "Good instinct for trade-offs between speed and polish",
  ],
  improvements: [
    "Add one concrete metric per story (latency, conversion, NPS)",
    "Go deeper on technical decisions — alternatives you considered",
    "Shorten intros to leave more time for follow-up questions",
  ],
};

export function demoSwipeRow(job, direction, days = 1) {
  return {
    swipe_id: `demo_swipe_${job.job_id}`,
    job_id: job.job_id,
    job,
    direction,
    match_score: job.match_score,
    created_at: daysAgoIso(days),
  };
}

export const DEMO_HISTORY_RIGHT = [
  demoSwipeRow(DEMO_JOBS[5], "right", 2),
  demoSwipeRow(DEMO_JOBS[6], "right", 4),
];

export const DEMO_HISTORY_LEFT = [demoSwipeRow(DEMO_JOBS[7], "left", 1)];
