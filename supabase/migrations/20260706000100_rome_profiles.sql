-- Cache for France Travail ROME 4.0 occupation profiles (used by job card details).
CREATE TABLE IF NOT EXISTS rome_profiles (
  rome_code TEXT PRIMARY KEY,
  fetched_at TIMESTAMPTZ,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rome_profiles_fetched_at ON rome_profiles (fetched_at DESC);
