-- friend_referral_codes/friend_referral_redemptions were created without the
-- `data jsonb` catch-all column that every other migrated table has (see
-- creator_invites, ats_company_sources, etc.) -- the Python adapter's
-- _supabase_row mapping and generic read path (select=data) assume it
-- exists on every table, so every write/read against these two tables was
-- failing with a PostgREST "column not found" error.

ALTER TABLE friend_referral_codes
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE friend_referral_redemptions
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
