# Job Cache Cron Setup

These endpoints are intended for Railway cron or another scheduled HTTP caller after staging smoke testing. They are admin-protected and must not be exposed without an admin bearer token.

Use placeholders only:

```bash
export BACKEND_URL="https://your-backend.example.com"
export ADMIN_AUTH_TOKEN="admin-session-or-service-token"
```

## Daily Maintenance

Endpoint:

```text
POST /api/admin/jobs/maintenance
```

Suggested schedule: once daily during low traffic.

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/maintenance" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":false,"refresh_popular":false}'
```

This expires stale jobs, revalidates old/unknown jobs, and optionally performs limited ATS source discovery/refresh.

## Direct ATS Known Sources Refresh

Endpoint:

```text
POST /api/admin/jobs/ats/refresh-known-sources
```

Suggested schedule: every 6-12 hours after `ats_company_sources` contains enough companies.

Start conservatively:

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/ats/refresh-known-sources" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":10,"older_than_hours":12}'
```

Production can increase to `limit:25` after confirming request time and provider responses.

## Revalidation

Endpoint:

```text
POST /api/admin/jobs/revalidate
```

Suggested schedule: every 12-24 hours.

```bash
curl -X POST "$BACKEND_URL/api/admin/jobs/revalidate" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"older_than_hours":24,"limit":100,"dry_run":false}'
```

## Cache Status

Endpoint:

```text
GET /api/admin/jobs/cache-status
```

Use this before and after maintenance jobs:

```bash
curl "$BACKEND_URL/api/admin/jobs/cache-status" \
  -H "Authorization: Bearer $ADMIN_AUTH_TOKEN"
```

Check `valid_ab_jobs`, `unknown_c_jobs`, `invalid_de_jobs`, `stale_jobs_sampled`, and `ats_company_sources_count`.

## Safety Notes

- Do not run cron without admin authorization.
- Keep `JOBS_POPULAR_REFRESH_ENABLED=false` initially.
- Keep refresh limits low while observing provider cost and response times.
- Use dry runs first on staging.
- Watch Railway logs for JSearch fallback counts and provider rate-limit messages.
