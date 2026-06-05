# Swiipr

Swiipr is a job matching and application automation app. It combines a swipe-based job feed, CV/profile parsing, tailored application packages, and a Greenhouse-first submission pipeline.

## Stack

- Frontend: React, CRACO, Tailwind, shadcn-style components
- Backend: FastAPI, asyncpg, Supabase (PostgreSQL)
- AI: OpenAI adapter via `OPENAI_API_KEY`
- Jobs: Supabase as source of truth, Greenhouse direct import, JSearch discovery/fallback
- ATS submission: Greenhouse V1

## Local Setup

Backend environment variables are read from `backend/.env`:

```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
# Optional — improves location autocomplete (Places API). Without it, OpenStreetMap is used.
GOOGLE_MAPS_API_KEY=
JSEARCH_API_KEY=
GREENHOUSE_SUBMIT_DRY_RUN=true
ENVIRONMENT=development
FRONTEND_URL=http://localhost:3000

# Google OAuth (Sign up with Google)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8001/api/auth/google/callback
```

Frontend environment variables are read from `frontend/.env`:

```env
REACT_APP_BACKEND_URL=http://localhost:8001
REACT_APP_GOOGLE_MAPS_API_KEY=
```

## Google Sign-up + Supabase

### 1. Supabase database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → Database** and copy the **Connection string (URI)**.
3. Paste it into `backend/.env` as `DATABASE_URL`.

On first backend startup, Swiipr runs `backend/supabase_schema.sql` automatically and creates:

- `users` — `user_id`, `email`, profile fields in JSONB
- `user_sessions` — `session_token`, `user_id`, `expires_at`
- `profiles`, `jobs`, `swipes`, `applications`, `company_boards`

You can inspect rows in the Supabase **Table Editor** or SQL Editor:

```sql
SELECT user_id, email, data FROM users;
SELECT session_token, user_id, data FROM user_sessions;
```

### 2. Google Cloud OAuth

1. Open [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (type: Web application).
3. Add **Authorized JavaScript origins**: `http://localhost:3000` (or your React dev port).
4. Add **Authorized redirect URI**:
   `http://localhost:8001/api/auth/google/callback`
5. Copy the Client ID and Client Secret into `backend/.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8001/api/auth/google/callback
FRONTEND_URL=http://localhost:3000
```

If your React app runs on another port (e.g. `3001`), update `FRONTEND_URL` accordingly.

### 3. Auth flow

1. User clicks **Sign up with Google** in onboarding.
2. Browser goes to `GET /api/auth/google/login?redirect=/onboarding?step=jobSearch`.
3. Google authenticates the user and calls the backend callback.
4. Backend stores the user in Supabase, creates a session, then redirects to:
   `http://localhost:3000/onboarding?step=jobSearch#session_token=...`
5. The frontend reads the token, calls `/api/auth/me`, and continues onboarding.

## Run

Backend:

```bash
cd backend
pip install -r requirements.txt
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
