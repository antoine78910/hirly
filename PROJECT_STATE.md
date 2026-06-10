# Hirly Project State

Last audited: 2026-06-07

## Product Overview

Hirly is a mobile-first job search and application automation app. Users sign in with Google, complete onboarding, upload a CV, set job preferences, swipe through compatible jobs, and generate tailored application packages. The current product direction prioritizes jobs that can eventually support one-swipe auto-apply through known ATS systems.

The core user loop is:

1. Sign in with Supabase Google Auth.
2. Complete onboarding and upload a CV.
3. Browse a swipe-based job feed.
4. Swipe right to generate a tailored CV, cover letter, and application package.
5. For Greenhouse jobs, run a browser preparation flow after right swipe to classify whether the application is prepared, blocked by user-specific questions, blocked by CAPTCHA, or failed to prepare.
6. Track generated application packages and resolve action-required fields from the Tracker page.

## Current Architecture

### Frontend

- React app using CRACO and Create React App tooling.
- React Router for routes.
- Tailwind CSS plus shadcn/Radix-style UI components.
- Supabase JS client for Google OAuth.
- Axios API client with cookie support and bearer-token fallback from `localStorage.session_token`.
- Mobile-first pages under `frontend/src/pages`.

Primary frontend routes:

- `/` landing page.
- `/auth/callback` Supabase OAuth callback.
- `/onboarding` onboarding flow.
- `/swipe` job feed and swipe UI.
- `/tracker` generated applications and action-required resolution.
- `/profile` profile, CV, preferences, profile completion.
- `/interviews`, `/improve`, `/history`, `/emails`, `/people`, `/settings`.

### Backend

- FastAPI backend in `backend/server.py`.
- Supabase/Postgres runtime database through `backend/db/supabase_adapter.py`.
- Mongo has been removed from runtime. Archived migration scripts still reference Mongo.
- OpenAI adapter in `backend/llm_client.py`.
- Job providers in `backend/job_providers`.
- Browser automation engines in `backend/browser_submission`.
- Application document generation in `backend/application_documents.py`.

The backend keeps a Mongo-like collection API surface internally (`find_one`, `find`, `update_one`, etc.) but routes now use a Supabase adapter behind that interface.

## Database State

Runtime database: Supabase/Postgres.

Runtime tables:

- `users`
- `user_sessions`
- `profiles`
- `jobs`
- `applications`
- `swipes`
- `company_boards`
- `browser_submission_runs`

Each table stores selected top-level columns for common filters plus the full application document in `data jsonb`. The adapter restores API documents from `data`.

Schema files:

- `backend/db/supabase_low_risk_schema.sql`
- `backend/db/supabase_phase2_schema.sql`
- `backend/db/supabase_auth_schema.sql`

Adapter mapping:

- `backend/db/__init__.py` always creates `SupabaseDatabaseAdapter`.
- `backend/db/supabase_adapter.py` defines table primary keys, filterable top-level columns, jsonb restoration, and Mongo-like collection methods.

## API Routes

Major route groups:

- Auth: `/api/auth/supabase-session`, `/api/auth/me`, `/api/auth/logout`, dev login.
- Profile/onboarding: `/api/profile`, `/api/profile/cv`, `/api/profile/preferences`, `/api/profile/contact`, onboarding suggestions, location search.
- Jobs: `/api/jobs/feed`.
- Swipe: `/api/swipe`, swipe history, undo, delete swipe.
- Applications: list/detail, status update, tailored CV/cover letter downloads, missing info resolution.
- Greenhouse API submit path: form preview, prepare-submit, submission preview, validate-submit, submit.
- Browser automation: Lever prepare/submit/benchmark, Greenhouse prepare/submit/benchmark.
- Dev diagnostics: provider import tests, db health/counts, job debug, Playwright launch, docx fallback, database usage audit.

See `ARCHITECTURE.md` for a fuller route map.

## Existing Features

- Supabase Google login.
- App session token creation and `/api/auth/me`.
- Dev login endpoint gated by dev environment flags.
- Onboarding with category and role suggestions, location selection, role selection, CV upload, preferences.
- CV upload and extraction through OpenAI.
- Structured profile with contact, target role, target location, target location data, CV text, original CV metadata.
- Job feed with strict auto-apply-compatible default behavior.
- Greenhouse and Lever direct job imports.
- JSearch discovery/fallback integration.
- ATS detection fields on jobs.
- Swipe UI with cards, filters, match scores, and descriptions.
- Right swipe generates application package.
- Tailored CV and cover letter generation through OpenAI.
- DOCX generation with invalid XML character sanitization and text-only fallback.
- Tracker page with application statuses and action-required answer resolution.
- Coach/interview prep, interview scoring, improve analysis.
- Greenhouse API submission preparation and dry-run submit path.
- Lever browser automation prepare/submit benchmark path.
- Greenhouse browser automation experiment and benchmark path.
- Supabase-only database diagnostics.

## Known Technical Debt

- `backend/server.py` is very large and contains auth, profile, jobs, swipe, application, provider diagnostics, and browser automation endpoints in one file.
- Backend tests still include Mongo fixtures and older assumptions even though runtime is Supabase-only.
- `backend/coach.py` comments still mention Claude even though the active LLM adapter is OpenAI.
- `backend/requirements.txt` still includes unused or legacy dependencies such as `pymongo` and multiple Google/Gemini/LiteLLM libraries.
- Greenhouse has two submission strategies: public API submit and browser automation. Their product status should be clarified.
- Lever browser automation has substantial provider-specific logic including TSMG-specific field names.
- Greenhouse browser automation subclasses the Lever engine, which is pragmatic but makes provider boundaries less clear.
- Job feed filtering/ranking has several fallback paths and performance guards embedded directly in `server.py`.
- Browser automation is inherently brittle and needs reliable run storage, replay diagnostics, and manual handoff UX.
- Several dev endpoints are always or broadly available depending on environment flags and should be reviewed before production.
- Frontend contains temporary console logs from auth/onboarding debugging.
- Some frontend text and comments contain mojibake characters from encoding issues.
- `frontend/src/components/DocumentsSheet.jsx` is a placeholder.
- Settings actions such as theme picker, AI settings, subscription, restore purchase, and walkthrough are placeholders.
- Industry filters are UI placeholders because jobs do not have an industry field yet.

## Pending TODOs And Placeholders

Product placeholders:

- Additional document uploads.
- Subscription/upgrade flow.
- Notification preferences.
- AI preference tuning.
- Product tour replay.
- Industry filtering.
- Real company/job count in filters.
- Real final submission UX for browser-based ATS flows.
- Manual CAPTCHA handoff UX.
- Ashby sourcing and automation.

Engineering placeholders:

- Runtime Supabase is complete, but archived Mongo migration scripts remain.
- Some tests still require Mongo env vars.
- Mock job seed exists only behind `JOB_PROVIDER_FALLBACK_MOCK=true`.
- Browser automation benchmark endpoints exist, but no production-quality queue/workflow exists yet.
- Greenhouse browser prepare after swipe is wired, but there is no automatic real submit.

## Recent Implementation Patterns

- Supabase adapter preserves Mongo-style route calls and full document shape in `data jsonb`.
- Provider imports normalize jobs into a shared job document shape.
- Auto-apply compatibility is explicit: `ats_provider`, `auto_apply_supported`, `auto_apply_reason`.
- Browser submission engines return rich diagnostic objects rather than only success/failure.
- Submission state is separated from package generation state.
- Sensitive/legal/factual answers are blocked unless explicitly saved by the user.
- OpenAI calls are centralized through `llm_client.complete_json_text`.
- DOCX generation sanitizes output and should not fail a swipe if file generation fails.
- Dev endpoints are used heavily to prove individual integration steps.

## Coding Conventions

- Backend uses async FastAPI handlers and Pydantic models mostly in `server.py`.
- Database calls use Mongo-like adapter methods: `db.jobs.find(...)`, `db.applications.update_one(...)`.
- Documents use snake_case keys.
- IDs are prefixed strings such as `job_...`, `app_...`, `run_...`.
- Job providers use deterministic internal job IDs derived from provider and external ID hashes.
- Frontend components are mostly function components with hooks.
- Frontend uses Tailwind utility classes and lucide icons.
- API calls go through `frontend/src/lib/api.js`.
- Auth calls go through `frontend/src/lib/auth.js` and `frontend/src/lib/supabase.js`.

## Recommended Next Priorities

1. Stabilize right-swipe to Greenhouse prepare pipeline end to end.
2. Improve application generation quality by refusing to label low-context output as tailored.
3. Move Greenhouse/Lever browser automation into smaller services/modules instead of continuing to expand `server.py`.
4. Build a clear Tracker action flow for Greenhouse browser required questions and submit readiness.
5. Decide whether Greenhouse public API submit is still a target or whether hosted-browser automation is the primary path.
6. Add production hardening for dev endpoints, logging, secrets, browser profiles, timeouts, and run storage.
7. Update tests for Supabase-only runtime and remove Mongo-dependent fixtures from active test paths.
8. Add Ashby sourcing after Greenhouse/Lever submission behavior is stable.
9. Clean frontend placeholders and temporary console logs.
10. Split `server.py` into routers and service modules once current product flows are stable.
