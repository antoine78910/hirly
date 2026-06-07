# Roadmap

## Current Strategic Goal

Make the first real one-swipe application workflow reliable enough that a user can:

1. Sign in.
2. Complete onboarding.
3. See relevant auto-apply-compatible jobs quickly.
4. Swipe right.
5. Get a high-quality tailored package.
6. Either see "prepared" or answer explicit action-required questions.
7. Submit only when safe and confirmed.

## Phase 0: Stabilize Current Critical Flow

Priority: immediate.

### 1. Greenhouse right-swipe prepare

Finish validating this path:

- Right swipe on Greenhouse job.
- Application package generated with non-empty tailored CV and cover letter.
- Greenhouse browser prepare runs after package save.
- Application ends with one of:
  - `prepared`
  - `action_required`
  - `blocked_captcha`
  - `blocked`
  - `prepare_failed`

Acceptance:

- No right swipe fails because of DOCX build, Supabase read-after-write, browser prepare timeout, or OpenAI latency.
- Tracker displays the resulting status clearly.

### 2. Application generation quality guardrails

Current risk: fallback or low-context generation can look like a real tailored package.

Build/verify:

- Log CV text length, job description length, tailored resume length, cover letter length, match score, and generation mode.
- If CV text or job description is too short, set `package_status=needs_profile_data` or `needs_job_data`.
- Do not create empty DOCX sections.
- Show user-facing messaging when package quality is not enough.

Acceptance:

- A generated package is either meaningfully tailored or explicitly marked incomplete.

### 3. Action Required UX

The backend can classify missing legal/factual questions. The product flow should be reliable.

Build/verify:

- Tracker displays `action_required`.
- Required question labels/options are readable.
- Save answers updates `profile.application_defaults` when requested.
- Re-running prepare uses saved defaults.

Acceptance:

- A user can answer work authorization, sponsorship, hybrid/onsite acknowledgement, and non-compete restrictions once and have future matching use those defaults.

## Phase 1: Submission Safety And Manual Handoff

Priority: high.

### 1. Decide primary Greenhouse submission strategy

There are two paths:

- Greenhouse public API submit endpoint.
- Hosted Greenhouse browser automation.

Recommended decision:

- Treat browser automation as the primary experiment for arbitrary employers.
- Keep public API submit as diagnostic/dry-run unless proven reliable for arbitrary boards.

### 2. Browser-submit UX

Build a safe user-triggered submit path:

- User clicks submit.
- Backend prepares/fills in visible or headless browser.
- If final click is safe and dry-run is false, click submit.
- If CAPTCHA appears, return `action_required` and screenshot/manual handoff.
- Never mark submitted unless success is detected.

Acceptance:

- Users never believe an application was submitted unless success is detected.

### 3. Manual CAPTCHA handoff

Do not bypass CAPTCHA.

Build:

- Status: `blocked_captcha`.
- UI: "Human verification required."
- Show screenshot or open browser handoff strategy.
- Store run and final URL.

## Phase 2: Feed And Job Quality

Priority: high.

### 1. Improve direct ATS sourcing

Current providers:

- Greenhouse direct import.
- Lever direct import.
- JSearch discovery/fallback.

Next:

- Add Ashby direct provider.
- Expand board discovery and board health tracking.
- Add company diversity to import and feed stages.
- Maintain high-quality seed board lists and disable invalid boards.

### 2. Role and location matching

Improve:

- Normalize role families server-side.
- Add city/country parsed fields to jobs.
- Add geocoded locations where providers expose them or where we can derive them.
- Move from label matching to actual radius search.

Acceptance:

- A Paris full-stack developer gets relevant worldwide fallback jobs in under 3 seconds.

### 3. Feed observability

Keep:

- stage counts
- elapsed time
- fallback reason
- provider refresh reason

Add:

- user-visible reason when no one-swipe jobs match.
- admin/dev dashboard for provider counts and stale boards.

## Phase 3: Backend Modularity

Priority: medium, after core flows stabilize.

### 1. Split `server.py`

Recommended modules:

- `routes/auth.py`
- `routes/profile.py`
- `routes/jobs.py`
- `routes/swipes.py`
- `routes/applications.py`
- `routes/dev.py`
- `services/applications.py`
- `services/submission.py`
- `services/feed.py`

Acceptance:

- Route behavior unchanged.
- Integration tests pass.
- `server.py` only creates app, middleware, startup/shutdown, and includes routers.

### 2. Strengthen adapter interface

The Supabase adapter currently mimics Mongo. That was useful for migration but hides performance traps.

Recommended:

- Add explicit repository functions for hot paths like feed, applications by user/job, provider upsert.
- Keep collection adapter for low-risk generic operations.

## Phase 4: Tests And Production Hardening

Priority: medium.

### 1. Update tests for Supabase-only runtime

Current tests still reference Mongo fixtures.

Tasks:

- Replace Mongo setup with Supabase test fixtures or mocked adapter.
- Add tests for right swipe application status.
- Add tests for DOCX fallback.
- Add tests for Greenhouse action-required classification.
- Add tests for feed performance fallback.

### 2. Secrets and environment hardening

Tasks:

- Ensure Supabase service role key is backend-only.
- Review dev endpoints before deployment.
- Gate or remove destructive/dev endpoints in production.
- Remove unused dependencies.
- Add `.env.example` if missing.

### 3. Browser automation operations

Tasks:

- Isolate browser profiles per user/run or define a safe shared strategy.
- Store screenshots with retention rules.
- Add queueing for long browser runs.
- Add run cancellation and timeouts.
- Avoid blocking API requests for long automation jobs.

## Phase 5: Product Expansion

Priority: after first submission proof.

### 1. Ashby

- Add direct Ashby sourcing.
- Add browser prepare experiment.
- Benchmark CAPTCHA and field handling.

### 2. Lever production path

- Convert current benchmark/prepare flow into user-facing submit flow if success rate is acceptable.
- Add stronger company-specific defaults and anti-CAPTCHA manual handoff.

### 3. Better documents

- Support additional attachments.
- Store supporting documents in profile.
- Attach documents only when the ATS form requests them.

### 4. Application intelligence

- Better matching between job requirements and CV facts.
- Show why the tailored CV changed.
- Let users approve reusable legal/default answers.

## Recommended Next Sprint

1. Retest a Greenhouse right swipe and inspect saved application fields.
2. Fix any status mismatch between backend response and Tracker.
3. Add a user-facing action-required form for Greenhouse browser required questions if not fully connected.
4. Add generation quality guardrails to block generic/empty packages from being presented as complete.
5. Disable or hide public Greenhouse API submit UI until arbitrary-company viability is proven.
6. Update Supabase-only tests for `/api/auth/me`, `/api/profile`, `/api/jobs/feed`, `/api/swipe`, and `/api/applications`.
