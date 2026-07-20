# Hirly

Hirly is a job matching and application automation app. It combines a swipe-based job feed, CV/profile parsing, tailored application packages, and a Greenhouse-first submission pipeline.

## Stack

- Frontend: React, CRACO, Tailwind, shadcn-style components
- Backend: FastAPI, Supabase/Postgres
- AI: OpenAI adapter via `OPENAI_API_KEY`
- Jobs: Supabase as source of truth, Greenhouse/Lever direct import, JSearch discovery/fallback
- ATS submission: Greenhouse V1

## Local Setup

Backend environment variables are read from `backend/.env`:

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_DB_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
JSEARCH_API_KEY=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
# Optional. Defaults to a key derived from SUPABASE_SECRET_KEY.
GMAIL_TOKEN_ENCRYPTION_KEY=
GREENHOUSE_SUBMIT_DRY_RUN=true
```

Frontend environment variables are read from `frontend/.env`:

```env
REACT_APP_BACKEND_URL=http://localhost:8001
REACT_APP_GOOGLE_MAPS_API_KEY=
```

## Run

Backend:

```bash
cd backend
python -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Frontend:

```bash
cd frontend
npm install --legacy-peer-deps
npm start
```

## TypeScript Workspace

New isolated TypeScript capabilities use the root Bun workspace. The workspace
is limited to `apps/*` and `packages/*`; the production Create React App in
`frontend/` is intentionally excluded.

```bash
bun install --frozen-lockfile
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
bun test tests/workspace-isolation.test.ts
bun run verify:job-supply-release
```

Run the legacy frontend from its own directory with its existing npm install
path. Do not replace this with a root Bun install:

```bash
cd frontend
npm install --legacy-peer-deps
CI=false npm run build
```

The root `vercel.json`, `frontend/vercel.json`, `frontend/package.json`, and
`frontend/package-lock.json` remain authoritative for the current frontend
deployment. New workspace applications must use separate deployment projects
and must not take over existing routes.

The local checks above do not create or validate a Vercel preview. Previewing
the current production project with root Bun files present is an external,
approval-gated isolation check and must be completed before activating a root
workspace deployment path.

Job-source operations are documented separately:

- `docs/operations/job-source-readiness-matrix.md` is the authoritative
  provider policy, trial, production, and canonical-writer readiness view.
- `docs/operations/job-source-shadow-trial.md` describes evidence-only source
  trials that cannot write canonical jobs or enqueue applications.
- `docs/operations/job-supply-release-readiness.md` defines ordered migrations,
  full local verification, deployment preflight, and rollback.

## Engineering Stack Policy

Hirly fixes existing Python behavior in place, builds new isolated backend
capabilities in TypeScript, and migrates bounded Python capabilities when
substantial product work reaches them. See `AGENTS.md` and
`docs/engineering/stack-migration-policy.md`.

Enable the tracked stack-policy pre-commit hook once per clone:

```bash
git config core.hooksPath .githooks
```

## Greenhouse Submission Safety

`GREENHOUSE_SUBMIT_DRY_RUN=true` is the default. With dry run enabled, the submit endpoint validates and builds the multipart payload but does not send the application to Greenhouse.

Use these backend endpoints to verify an application before real submission:

- `POST /api/applications/greenhouse/prepare-submit`
- `GET /api/applications/greenhouse/submission-preview?job_id=<job_id>`
- `POST /api/applications/greenhouse/validate-submit`
- `POST /api/applications/greenhouse/submit`

Only set `GREENHOUSE_SUBMIT_DRY_RUN=false` when ready to send real applications.
