# Swiipr

Swiipr is a job matching and application automation app. It combines a swipe-based job feed, CV/profile parsing, tailored application packages, and a Greenhouse-first submission pipeline.

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

## Greenhouse Submission Safety

`GREENHOUSE_SUBMIT_DRY_RUN=true` is the default. With dry run enabled, the submit endpoint validates and builds the multipart payload but does not send the application to Greenhouse.

Use these backend endpoints to verify an application before real submission:

- `POST /api/applications/greenhouse/prepare-submit`
- `GET /api/applications/greenhouse/submission-preview?job_id=<job_id>`
- `POST /api/applications/greenhouse/validate-submit`
- `POST /api/applications/greenhouse/submit`

Only set `GREENHOUSE_SUBMIT_DRY_RUN=false` when ready to send real applications.
