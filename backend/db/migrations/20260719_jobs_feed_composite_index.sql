-- Feed composite index: apply on Supabase (SQL editor or migration runner).
-- Safe to re-run (IF NOT EXISTS).
--
-- Speeds up /jobs/feed candidate reads filtered by tier + validation + country
-- and ordered by imported_at.

CREATE INDEX IF NOT EXISTS idx_jobs_feed_tier_country_imported
  ON jobs (applyability_tier, validation_status, country_code, imported_at DESC NULLS LAST);
