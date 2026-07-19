-- Jobs inventory schema (standalone PostgREST / second Supabase / Railway+PostgREST).
-- Keep auth/users/profiles on the primary Supabase project.
-- Apply this SQL on the inventory database, then set:
--   JOBS_SUPABASE_URL
--   JOBS_SUPABASE_SECRET_KEY

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  provider TEXT,
  external_id TEXT,
  title TEXT,
  normalized_title TEXT,
  company TEXT,
  normalized_company TEXT,
  location TEXT,
  city TEXT,
  region TEXT,
  country_code TEXT,
  remote BOOLEAN,
  salary_min NUMERIC,
  salary_max NUMERIC,
  currency TEXT,
  posted_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  provider_search_key TEXT,
  ats_provider TEXT,
  auto_apply_supported BOOLEAN,
  manual_fulfillment_ready BOOLEAN,
  apply_fulfillment_status TEXT,
  apply_url_provider TEXT,
  selected_apply_url TEXT,
  validation_status TEXT,
  validation_reason TEXT,
  validation_checked_at TIMESTAMPTZ,
  requires_login BOOLEAN,
  requires_account_creation BOOLEAN,
  captcha_detected BOOLEAN,
  has_cv_upload BOOLEAN,
  has_cover_letter BOOLEAN,
  has_custom_questions BOOLEAN,
  applyability_score NUMERIC,
  applyability_tier TEXT,
  rejection_reason TEXT,
  fingerprint TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  migrated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_provider_external
  ON jobs (provider, external_id)
  WHERE provider IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_data_gin ON jobs USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_jobs_country_code ON jobs (country_code);
CREATE INDEX IF NOT EXISTS idx_jobs_imported_at ON jobs (imported_at);
CREATE INDEX IF NOT EXISTS idx_jobs_last_seen_at ON jobs (last_seen_at);
CREATE INDEX IF NOT EXISTS idx_jobs_provider_search_key ON jobs (provider_search_key);
CREATE INDEX IF NOT EXISTS idx_jobs_ats_provider ON jobs (ats_provider);
CREATE INDEX IF NOT EXISTS idx_jobs_validation_status ON jobs (validation_status);
CREATE INDEX IF NOT EXISTS idx_jobs_applyability_tier ON jobs (applyability_tier);
CREATE INDEX IF NOT EXISTS idx_jobs_feed_tier_country_imported
  ON jobs (applyability_tier, validation_status, country_code, imported_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS ats_company_sources (
  id TEXT PRIMARY KEY,
  ats_provider TEXT NOT NULL,
  source_key TEXT NOT NULL,
  company_name TEXT,
  careers_url TEXT,
  country_code TEXT,
  discovered_from_url TEXT,
  discovered_from_job_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  failure_count INTEGER DEFAULT 0,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  migrated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ats_company_sources_provider_source
  ON ats_company_sources (ats_provider, source_key);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_is_active ON ats_company_sources (is_active);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_last_checked_at ON ats_company_sources (last_checked_at);

CREATE TABLE IF NOT EXISTS company_boards (
  board_id TEXT PRIMARY KEY,
  ats_provider TEXT,
  company TEXT,
  board_token TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER,
  last_synced_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  migrated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friendly_company_career_pages (
  id TEXT PRIMARY KEY,
  company_name TEXT,
  career_page_url TEXT,
  domain TEXT,
  country_code TEXT,
  discovered_from_url TEXT,
  discovered_from_job_id TEXT,
  is_friendly BOOLEAN DEFAULT TRUE,
  requires_login BOOLEAN,
  captcha_detected BOOLEAN,
  has_file_upload BOOLEAN,
  last_checked_at TIMESTAMPTZ,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  migrated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geo_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geoname_id TEXT UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  ascii_name TEXT,
  alternate_names JSONB,
  country_code TEXT NOT NULL,
  admin1_code TEXT,
  admin2_code TEXT,
  feature_class TEXT,
  feature_code TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  population INTEGER DEFAULT 0,
  timezone TEXT,
  source TEXT DEFAULT 'geonames',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  migrated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geo_places_geoname_id ON geo_places (geoname_id);
CREATE INDEX IF NOT EXISTS idx_geo_places_normalized_name ON geo_places (normalized_name);
CREATE INDEX IF NOT EXISTS idx_geo_places_country_code ON geo_places (country_code);
CREATE INDEX IF NOT EXISTS idx_geo_places_lat_lng ON geo_places (latitude, longitude);
