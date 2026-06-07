# Architecture

## High-Level System

Swiipr is split into a React frontend and a FastAPI backend.

```
React / CRACO / Tailwind
  -> Axios API client
  -> FastAPI /api routes
  -> Supabase adapter
  -> Supabase/Postgres tables with jsonb document storage

External services:
  - Supabase Auth for Google OAuth
  - OpenAI for profile extraction and generation
  - Google Maps / Places and OSM Nominatim for locations
  - Greenhouse, Lever, JSearch for job sourcing
  - Playwright/Chromium for hosted ATS browser automation
```

## Frontend Architecture

### Stack

- React 19.
- React Router 7.
- CRACO over Create React App.
- Tailwind CSS.
- Radix UI primitives and shadcn-style components.
- lucide-react icons.
- framer-motion for transitions.
- axios for backend API calls.
- Supabase JS client for Google OAuth.

### Key Files

- `frontend/src/App.js`: route map and global providers.
- `frontend/src/context/AuthContext.jsx`: app auth state, `/auth/me` check.
- `frontend/src/lib/api.js`: Axios instance, backend URL, bearer token fallback.
- `frontend/src/lib/auth.js`: starts Supabase Google login or explicit dev login when enabled.
- `frontend/src/lib/supabase.js`: Supabase JS client.
- `frontend/src/pages/AuthCallback.jsx`: exchanges Supabase OAuth code/session with backend.
- `frontend/src/pages/Onboarding.jsx`: onboarding flow and CV upload.
- `frontend/src/pages/Swipe.jsx`: job feed, filters, card rendering, swipes.
- `frontend/src/pages/Tracker.jsx`: applications list, status badges, action-required forms.
- `frontend/src/pages/Profile.jsx`: profile completion, CV, contact, job preferences.
- `frontend/src/components/PlacesAutocomplete.jsx`: real location selection.
- `frontend/src/components/RolePicker.jsx`: role selector with Other/manual path.
- `frontend/src/components/FiltersModal.jsx`: jobs filters with multiple locations and radius slider.

### Auth Flow

1. Landing calls `startGoogleLogin("/swipe")`.
2. `startGoogleLogin` calls Supabase `signInWithOAuth({ provider: "google" })`.
3. Supabase redirects to `/auth/callback?next=/swipe`.
4. `AuthCallback.jsx` exchanges the OAuth code/session with Supabase.
5. Frontend sends Supabase `access_token` to `POST /api/auth/supabase-session`.
6. Backend verifies token with Supabase, upserts user, creates an app session token.
7. Frontend stores `session_token` in localStorage.
8. Axios adds `Authorization: Bearer <session_token>` on API requests.
9. `/api/auth/me` returns user plus `has_profile` and `has_preferences`.

Dev login exists behind `DEV_TOOLS_ENABLED=true` or `ENVIRONMENT=development`, but frontend only uses it when `REACT_APP_DEV_LOGIN_ENABLED=true`.

## Backend Architecture

### Stack

- FastAPI.
- Pydantic.
- httpx.
- Supabase/PostgREST through a custom adapter.
- OpenAI SDK.
- python-docx.
- BeautifulSoup.
- Playwright.

### Key Files

- `backend/server.py`: main API application and route handlers.
- `backend/db/base.py`: collection/database adapter contracts.
- `backend/db/__init__.py`: creates the Supabase adapter.
- `backend/db/supabase_adapter.py`: Mongo-like collection API implemented over Supabase REST.
- `backend/llm_client.py`: OpenAI JSON completion adapter.
- `backend/application_documents.py`: tailored DOCX and cover-letter document helpers.
- `backend/jobs_service.py`: job refresh, provider seeding, provider import orchestration.
- `backend/job_providers/jsearch.py`: JSearch integration.
- `backend/job_providers/greenhouse.py`: Greenhouse public board integration.
- `backend/job_providers/lever.py`: Lever public postings integration.
- `backend/browser_submission/lever.py`: Lever Playwright engine.
- `backend/browser_submission/greenhouse.py`: Greenhouse Playwright experiment.
- `backend/browser_submission/field_extractors.py`: DOM form field extraction script.
- `backend/browser_submission/matching.py`: field-to-profile/application matching rules.
- `backend/onboarding_suggestions.py`: AI/fallback onboarding suggestions.
- `backend/location_search.py`: OSM/Google location search.
- `backend/coach.py`: interview and improve AI helpers.

## Database Adapter

The active runtime is Supabase only. `create_database_adapter()` constructs `SupabaseDatabaseAdapter` using:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- optional `SUPABASE_DB_URL`

Routes use collection-style calls:

- `db.users.find_one(...)`
- `db.profiles.update_one(...)`
- `db.jobs.find(...).sort(...).limit(...).to_list(...)`
- `db.applications.count_documents(...)`

The Supabase adapter:

- Upserts rows through PostgREST.
- Stores full documents in `data jsonb`.
- Also writes top-level columns needed for filters.
- Restores documents from `data`.
- Supports a subset of Mongo filters: equality, `$in`, `$nin`, `$gte`, `$exists`, `$regex`, `$or`, `$and`.
- Pushes simple top-level filters to PostgREST where possible.
- Falls back to local filtering after reading rows when filters are more complex.

## Job Sourcing Architecture

### Providers

- Greenhouse direct board API.
- Lever direct postings API.
- JSearch discovery/fallback.
- Ashby is recognized in ATS detection but not implemented as direct provider yet.

### Provider Documents

Imported jobs normalize into the shared `jobs` schema:

- stable internal `job_id`
- provider metadata
- ATS metadata
- clean description fields
- requirements
- source URLs

Greenhouse and Lever set `auto_apply_supported=true`. JSearch may detect ATS links but is not the source of truth for direct ATS imports.

### Feed

`GET /api/jobs/feed`:

- Requires auth and a CV-ready profile.
- Defaults to strict `auto_apply_supported=true`.
- Excludes swiped jobs.
- Applies role, location, radius, country, company, salary, date, experience, and work-location filters where possible.
- Uses fast cached Supabase reads first.
- Broadens role/location if no strict local match is found.
- Avoids hanging by using timing guards and fallback jobs.
- Returns metadata such as `feed_mode`, `auto_apply_count`, `fallback_reason`, `searched_location`, `search_radius`, `widened_search`, `companies_returned`, and `filters_applied`.

## Swipe And Application Architecture

`POST /api/swipe`:

1. Authenticates user.
2. Loads job.
3. Inserts/upserts swipe.
4. For left swipe, returns without creating application.
5. For right swipe, loads profile and generates application package.
6. Uses OpenAI for tailored content.
7. Builds DOCX package when possible.
8. Falls back to text-only generation if DOCX build fails.
9. Upserts application in Supabase.
10. Verifies by `application_id` first.
11. For Greenhouse jobs, runs browser prepare after swipe without clicking submit.
12. Updates `submission_status` based on prepare result.

Application status fields:

- `package_status`: `not_generated`, `generated`, `generated_text_only`, `failed`, `pending_generation`, `needs_profile_data`, `needs_job_data`.
- `submission_status`: `not_submitted`, `ready`, `prepared`, `submitted`, `failed`, `blocked`, `action_required`, `blocked_captcha`, `prepare_failed`, `unknown`.

## Browser Submission Architecture

Browser automation is experimental and dry-run-first.

Shared result shape:

- fields detected
- fields filled
- field fill debug
- blockers
- unfilled required fields
- file uploads
- screenshot
- captcha debug
- success likelihood
- final click selector
- ready for final click

Lever:

- Opens hosted Lever page.
- Extracts fields from DOM.
- Uploads tailored CV and cover letter when applicable.
- Fills profile/contact fields and generated answers.
- Applies human-paced filling when configured.
- Can dry-run or click submit when `BROWSER_SUBMIT_DRY_RUN=false`.
- Stores runs in `browser_submission_runs`.

Greenhouse:

- Uses a Greenhouse-specific engine that currently extends the Lever browser engine.
- Opens hosted Greenhouse pages.
- Handles first name, last name, email, phone, resume, cover letter, custom questions, safe consent/referral values.
- Blocks legal/factual questions unless saved profile defaults exist.
- Runs after right swipe for Greenhouse jobs to classify application readiness.

## LLM Architecture

`backend/llm_client.py` exposes `complete_json_text(system_message, prompt)`.

Environment:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`, default `gpt-4.1-mini`

Consumers:

- CV extraction.
- Job scoring.
- Application generation.
- Greenhouse answer generation.
- Interview prep.
- Interview scoring.
- Improve analysis.
- Onboarding suggestion generation.

There is no mock AI fallback. Missing OpenAI config raises a clear provider-not-configured error.

## Environment Variables

Backend:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `JSEARCH_API_KEY`
- `JSEARCH_ENABLED`
- `JSEARCH_COUNTRY`
- `JSEARCH_LANGUAGE`
- `JOB_PROVIDER_PRIMARY`
- `JOB_PROVIDER_FALLBACK_MOCK`
- `GREENHOUSE_SUBMIT_DRY_RUN`
- `BROWSER_SUBMIT_DRY_RUN`
- `BROWSER_HEADLESS`
- `BROWSER_USER_DATA_DIR`
- `BROWSER_HUMAN_PACE`
- `BROWSER_MIN_DELAY_MS`
- `BROWSER_MAX_DELAY_MS`
- `BROWSER_TYPE_DELAY_MS`
- `BROWSER_PRE_SUBMIT_PAUSE_MS`
- `DEV_TOOLS_ENABLED`
- `ENVIRONMENT`
- `CORS_ORIGINS`
- provider import TTL/limit env vars in `jobs_service.py`

Frontend:

- `REACT_APP_BACKEND_URL`
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `REACT_APP_GOOGLE_MAPS_API_KEY`
- `REACT_APP_DEV_LOGIN_ENABLED`

## API Route Map

Auth:

- `POST /api/auth/supabase-session`
- `POST /api/dev/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Profile and onboarding:

- `POST /api/profile/cv`
- `GET /api/profile/cv/original`
- `GET /api/profile`
- `DELETE /api/profile`
- `PATCH /api/profile/extras`
- `GET /api/locations/search`
- `POST /api/onboarding/suggest-categories`
- `POST /api/onboarding/suggest-roles`
- `PUT /api/profile/preferences`
- `PUT /api/profile/contact`

Coach:

- `GET /api/coach/interview`
- `POST /api/coach/interview/score`
- `GET /api/coach/improve`
- `GET /api/coach/streak`

Jobs and swipes:

- `GET /api/jobs/feed`
- `POST /api/swipe`
- `GET /api/swipes/history`
- `DELETE /api/swipes/{job_id}`
- `POST /api/swipe/undo`

Applications:

- `GET /api/applications`
- `GET /api/applications/{application_id}`
- `PATCH /api/applications/{application_id}/status`
- `GET /api/applications/{application_id}/tailored-cv`
- `GET /api/applications/{application_id}/cover-letter`
- `POST /api/applications/{application_id}/resolve-missing-info`

Greenhouse:

- `GET /api/applications/greenhouse/form-preview`
- `POST /api/applications/greenhouse/prepare-browser-fill`
- `POST /api/applications/greenhouse/browser-submit`
- `POST /api/applications/greenhouse/submission-benchmark`
- `POST /api/applications/greenhouse/prepare-submit`
- `GET /api/applications/greenhouse/submission-preview`
- `POST /api/applications/greenhouse/validate-submit`
- `POST /api/applications/greenhouse/submit`

Lever:

- `POST /api/applications/lever/prepare-browser-fill`
- `POST /api/applications/lever/browser-submit`
- `POST /api/applications/lever/submission-benchmark`

Dev diagnostics:

- `POST /api/seed`
- `GET /api/`
- `GET /api/dev/jsearch-test`
- `GET /api/dev/greenhouse-import-test`
- `GET /api/dev/greenhouse-board-test`
- `GET /api/dev/lever-import-test`
- `GET /api/dev/lever-board-test`
- `GET /api/dev/provider-write-test`
- `GET /api/dev/playwright-launch-test`
- `GET /api/dev/asyncio-loop-debug`
- `GET /api/dev/lever-runtime-debug`
- `GET /api/dev/db-health`
- `GET /api/dev/db-counts`
- `GET /api/dev/applications-read-write-test`
- `GET /api/dev/docx-fallback-test`
- `GET /api/dev/db-provider-test`
- `GET /api/dev/jobs-query-debug`
- `GET /api/dev/database-usage-audit`
- `GET /api/dev/job-debug/{job_id}`
- `GET /api/dev/greenhouse-jobs-sample`
- `GET /api/dev/auto-apply-jobs-by-provider`
- `GET /api/dev/clean-job-descriptions`
