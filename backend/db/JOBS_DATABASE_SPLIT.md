# Jobs inventory split + egress reduction

## Problem

Supabase Pro egress was dominated by Hirly (~270 GB): `/jobs/feed` pulled full JSONB `data` for hundreds of candidate jobs per request.

## What shipped in code

1. **Feed light select** — candidate pool reads table columns only (`JOB_FEED_LIGHT_SELECT`). Full JSONB is hydrated only for the final swipe deck.
2. **Batch upserts** — import writes in chunks of ~75 instead of 1 HTTP call per job.
3. **Expire + purge** — soft-expire stale jobs; hard-delete invalid/D/E inventory via admin API.
4. **Optional DB split** — route inventory tables to a second PostgREST project.

## Apply index on current Supabase (do this first)

Run in Supabase SQL editor (primary project):

```sql
-- backend/db/migrations/20260719_jobs_feed_composite_index.sql
CREATE INDEX IF NOT EXISTS idx_jobs_feed_tier_country_imported
  ON jobs (applyability_tier, validation_status, country_code, imported_at DESC NULLS LAST);
```

## Purge dead inventory (reduces storage + future egress)

Admin (with maintenance enabled):

```http
POST /api/admin/jobs/purge-invalid
{
  "older_than_days": 30,
  "expire_first": true,
  "applyability_tiers": ["E", "D"],
  "limit": 500,
  "dry_run": true
}
```

Then re-run with `"dry_run": false`. Repeat until `matched_count` is small.

Or expire only:

```http
POST /api/admin/jobs/expire-stale
{ "older_than_days": 30, "limit": 500, "dry_run": false }
```

## Split auth DB vs jobs inventory (recommended)

Keep **login/signup/users/profiles/billing** on the current Supabase project.

Move **jobs inventory** to a dedicated Postgres + PostgREST:

| Option | Notes |
|--------|--------|
| Second Supabase project | Fastest: same adapter, separate egress quota |
| Neon + PostgREST | Cheap Postgres; add PostgREST sidecar or use Neon HTTP later |
| Railway Postgres + PostgREST | Best latency next to the API |

### Env vars (Railway)

```env
# Primary — auth + app state
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=...

# Inventory — jobs only (optional; omit to keep jobs on primary)
JOBS_SUPABASE_URL=https://yyyy.supabase.co
JOBS_SUPABASE_SECRET_KEY=...
# Optional direct Postgres URL for one-off scripts
JOBS_DATABASE_URL=postgresql://...
```

Collections routed when `JOBS_SUPABASE_*` is set:

- `jobs`
- `ats_company_sources`
- `company_boards`
- `friendly_company_career_pages`
- `geo_places`

### Bootstrap inventory DB

1. Create empty project / Postgres.
2. Apply [`backend/db/jobs_inventory_schema.sql`](jobs_inventory_schema.sql).
3. Copy data (script):

```bash
cd backend
python scripts/migrate_jobs_inventory.py --dry-run
python scripts/migrate_jobs_inventory.py
```

4. Set `JOBS_SUPABASE_URL` / `JOBS_SUPABASE_SECRET_KEY` and redeploy.
5. After verifying feed works, stop writing new jobs to the primary `jobs` table (split handles this automatically). Optionally truncate primary `jobs` later to reclaim storage.

## Expected egress impact

| Change | Effect |
|--------|--------|
| Light feed select | Largest win — pool reads drop from full descriptions to ~1–2 KB/row |
| Purge D/E jobs | Shrinks 30 GB storage and every scan |
| Split inventory DB | Auth project egress collapses; jobs billed on cheaper DB |
| Batch upserts | Fewer write round-trips (less egress + less load) |
