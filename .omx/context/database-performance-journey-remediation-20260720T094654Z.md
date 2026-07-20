# Context Snapshot: Database Performance Journey Remediation

## Task statement

Plan remediation of the identified database load issues in this product order:

1. landing page
2. signup
3. onboarding
4. user application usage
5. admin panel

The user requested `$ralplan`; this is planning-only. Another agent owns active goals, so this workflow must not read, alter, pause, complete, or otherwise interact with goal state.

## Desired outcome

Produce an implementation-ready, consensus-approved plan that reduces broad reads, JSONB transfer, read-before-write amplification, N+1 behavior, and admin full-table aggregation while preserving live product behavior and ordering delivery by user journey.

## Classification

`PY_FIX` — this is a production performance/reliability correction in the existing Python-owned backend and its PostgreSQL/PostgREST adapter. SQL migrations may add indexes or promoted columns, but the capability remains owned by the existing runtime. No new production Python module is required.

## Known facts and evidence

- Production routes use `SupabaseDatabaseAdapter` from `backend/db/supabase_adapter.py`, wired in `backend/server.py:280`.
- Generic reads default to `select=data`; projections are applied in Python after retrieval (`backend/db/supabase_adapter.py:985-1052`, `:932-954`).
- Filter pushdown supports only approved top-level columns with equality, `$in`, or one range operator; `$or`, `$and`, `$nin`, `$exists`, `$regex`, nested paths, and unknown columns fall back to local filtering (`backend/db/supabase_adapter.py:860-885`).
- Limited local-filter reads fetch up to `max(limit * 3, 1000)` rows; unlimited fallbacks can reach 10,000 rows (`backend/db/supabase_adapter.py:1006-1048`).
- Normal `update_one` is read-modify-full-upsert (`backend/db/supabase_adapter.py:1133-1171`).
- `update_many` is an initial read plus sequential `update_one` calls; `delete_many` is an initial read plus sequential deletes (`backend/db/supabase_adapter.py:1189-1208`).
- Landing page tracking performs one first-party analytics POST per event (`frontend/src/lib/analytics.js:24-42`); the backend inserts one analytics row per event (`backend/server.py:1707-1736`).
- Auth performs session and user reads on every authenticated request (`backend/server.py:1100-1153`).
- Signup/session exchange performs user lookup/update/read, session insert, optional Gmail read, profile read, and training-creator checks (`backend/server.py:1158-1196`, `:1316-1403`).
- Onboarding persists extras and search preferences repeatedly on step changes, with additional contact/extras writes (`frontend/src/pages/Onboarding.jsx:412-425`, `:897-929`, `:1024-1042`).
- Profile update endpoints frequently read, update through another read-modify-write, then read again (`backend/server.py:6200-6208`, `:6211-6311`, `:6314-6327`, `:6419-6464`).
- Current `/jobs/feed` uses the fast cached path and returns at `backend/server.py:8961`; the older code after that line is unreachable.
- Current feed candidate reads use a compact select (`backend/server.py:404-425`) and pushable validated filters (`backend/server.py:7437-7460`), but supporting user/application workflows still use the generic adapter.
- Auto-apply backfill uses unsupported `$nin`/queue-status filters then loops through candidate-specific reads and updates (`backend/auto_apply/queue.py:292-338`).
- Training and Gmail contain explicit N+1 patterns (`backend/training_service.py:272-278`, `:690-759`; `backend/gmail_sync.py:420-496`).
- Admin base data reads whole bounded datasets for users, profiles, applications, and optionally swipes, then aggregates in Python (`backend/server.py:11442-11503`, `:11785-12048`, `:12970-13148`).
- Admin analytics reads up to 10,000 analytics events and sorts/aggregates in Python (`backend/server.py:11610-11620`).
- Direct PostgreSQL statistics were not available: the configured direct database endpoint timed out during a read-only connection attempt.

## Constraints

- No implementation during ralplan.
- Do not interact with OMX/Codex goals.
- Preserve live activation, signup, onboarding completion, feed availability, fulfillment reliability, duplicate-submission protection, and billing correctness.
- No new dependency without explicit approval.
- Prefer existing adapter and schema patterns.
- New frontend files, if ultimately necessary, must be TypeScript/TSX; this plan does not require new frontend files.
- Database migrations must be additive first, separately deployable, reversible where practical, and safe under existing traffic.
- Avoid a broad Python-to-TypeScript migration; the product outcome is the database incident.

## Unknowns / open questions

- Live `pg_stat_statements`, table sizes, dead tuples, index hit rates, and connection wait distribution.
- Whether production has out-of-band indexes or promoted columns not represented in committed SQL.
- Current p50/p95/p99 latency and query/request counts per journey.
- Actual analytics event volume and retention requirements.
- Whether the deployed PostgREST version supports every desired mutation form; implementation must validate against the deployed API before cutover.

## Likely codebase touchpoints

- `backend/db/supabase_adapter.py`
- `backend/supabase_schema.sql`
- additive SQL migration under the repository’s active migration convention
- `backend/server.py`
- `backend/auto_apply/queue.py`
- `backend/gmail_sync.py`
- `backend/training_service.py`
- `backend/notifications_service.py`
- `frontend/src/lib/analytics.js`
- `frontend/src/pages/Onboarding.jsx`
- targeted tests under `backend/tests/` and existing frontend test locations

