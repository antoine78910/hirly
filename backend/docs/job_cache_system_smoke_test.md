# Job Cache System Smoke Test

Run this checklist on staging after deploying the backend code and Supabase schema.

Use placeholders only:

```bash
export BACKEND_URL="https://your-backend.example.com"
export ADMIN_AUTH_TOKEN="admin-session-or-service-token"
```

## A. Apply Supabase Schema

Run `backend/supabase_schema.sql` in Supabase SQL Editor or through the normal migration path.

Confirm:

- `jobs.data JSONB NOT NULL` still exists.
- normalized job columns exist, including `normalized_title`, `country_code`, `validation_status`, `applyability_tier`, and `fingerprint`.
- `ats_company_sources` exists.
- `idx_ats_company_sources_provider_source` exists on `(ats_provider, source_key)`.

## B. Run Normalized Column Backfill

From a backend environment with Supabase credentials configured:

```bash
cd backend
python scripts/backfill_job_normalized_columns.py
```

Confirm progress is printed and missing optional job fields do not fail the script.

## C. Start Backend With Staging Env Vars

Use the staging block from `backend/docs/job_cache_env_vars.md`.

Keep:

```env
JOBS_POPULAR_REFRESH_ENABLED=false
JOBS_ALLOW_UNKNOWN_TIER_IN_FEED=false
JOBS_ALLOW_UNKNOWN_TIER_APPLICATION=false
```

## D. Run Tests

From `backend`:

```bash
python -m pytest tests/test_job_normalization.py tests/test_supabase_job_columns.py tests/test_ats_detection.py tests/test_job_validation.py tests/test_jsearch_validation_integration.py tests/test_feed_db_first.py tests/test_pre_apply_validation.py tests/test_job_cache_maintenance.py tests/test_ats_adapters.py tests/test_ats_source_service.py -q
python -m pytest tests -q
```

Expected local result without live endpoint env vars: unit tests pass and live backend tests skip.

## E. Call Maintenance Dry Run

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/maintenance" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true,"refresh_popular":false}'
```

Confirm the response contains `expire_stale`, `revalidate`, `popular_refresh`, and `ats_direct`.

## F. Refresh One France Query

Do this before judging the user-facing feed. First user feed requests are intentionally bounded and should not be used to backfill a full market cache.

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/refresh" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"search_role":"sales","location":"Paris, France","country_code":"FR","limit":30,"dry_run":false}'
```

Confirm response includes `jsearch_called`, `imported_count`, `valid_count`, `unknown_count`, and `invalid_count`.

## G. Confirm Jobs Have Validation Fields

Check Supabase `jobs` rows inserted or updated by the refresh.

Confirm:

- `data` contains the full job payload.
- `validation_status` is populated.
- `applyability_tier` is populated.
- `selected_apply_url` is populated for valid A/B jobs.

## H. Discover ATS Sources

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/ats/discover-sources" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":500,"dry_run":false}'
```

Confirm `discovered_count` increases and `ats_company_sources` rows are created for Greenhouse, Lever, or Ashby.

## I. Refresh One Direct ATS Source

Pick a real row from `ats_company_sources`.

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/ats/refresh-source" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ats_provider":"greenhouse","source_key":"example","limit":50,"dry_run":false}'
```

Replace `example` with a real source key. Repeat with Lever or Ashby when available.

Confirm:

- `fetched_count` is reported.
- `imported_count` is reported.
- `last_checked_at` and `last_success_at` update.
- failures update `failure_count` and `last_error` without crashing the batch.

## J. Open App Feed And Confirm DB-First Logs

Open the app as a normal user with a completed profile.

Confirm backend logs show:

- DB search attempted.
- DB A/B job count.
- whether JSearch fallback was triggered.
- final returned count.

Default expected behavior:

- A/B jobs appear first.
- D/E jobs do not appear.
- C jobs do not appear unless `JOBS_ALLOW_UNKNOWN_TIER_IN_FEED=true`.

## K. Right Swipe Valid A/B Job

Swipe right on a job with:

- `validation_status=valid`
- `applyability_tier=A` or `B`
- `selected_apply_url` present
- no login/account/captcha flags

Confirm:

- backend logs show pre-apply validation started and allowed.
- credit decrements only after validation passes.
- swipe is stored.
- application is created.
- package generation is queued.

## L. Try Invalid/Login-Required Job

Use a LinkedIn, Indeed, France Travail, HelloWork, or no-apply-url job.

Confirm:

- right swipe is blocked.
- credit is not decremented.
- application is not created.
- job validation fields are persisted as invalid/D or E.

## M. Call Expire-Stale Dry Run

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/expire-stale" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"older_than_days":30,"limit":100,"dry_run":true}'
```

Confirm `scanned_count` and `expired_count` are reported, and no rows are updated because `dry_run=true`.

## N. Confirm JSearch Is Not Called When DB Is Sufficient

After enough valid A/B jobs exist for the same role/location, reload the feed.

Confirm logs show:

- DB good count is above threshold.
- JSearch fallback is not triggered.
- returned feed still contains expected fields such as `match_score` and `match_reasons`.

## Optional Cache Status Check

```bash
curl "$BACKEND_URL/api/admin/jobs/cache-status" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN"
```

Review `total_jobs`, `valid_ab_jobs`, `unknown_c_jobs`, `invalid_de_jobs`, `stale_jobs_sampled`, `jobs_by_ats_provider`, and `ats_company_sources_count`.
