-- Swiipr schema for Supabase (PostgreSQL)
-- Run once in Supabase SQL Editor or via init_db() on startup.

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  data JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

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
  data JSONB NOT NULL
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS normalized_title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS normalized_company TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remote BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider_search_key TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_provider TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_apply_supported BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS manual_fulfillment_ready BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_fulfillment_status TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url_provider TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS selected_apply_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_status TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_reason TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_checked_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requires_login BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requires_account_creation BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS captcha_detected BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS has_cv_upload BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS has_cover_letter BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS has_custom_questions BOOLEAN;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applyability_score NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applyability_tier TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_provider_external
  ON jobs (provider, external_id)
  WHERE provider IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_data_gin ON jobs USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_jobs_country_code ON jobs (country_code);
CREATE INDEX IF NOT EXISTS idx_jobs_region ON jobs (region);
CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs (city);
CREATE INDEX IF NOT EXISTS idx_jobs_remote ON jobs (remote);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs (posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_imported_at ON jobs (imported_at);
CREATE INDEX IF NOT EXISTS idx_jobs_last_seen_at ON jobs (last_seen_at);
CREATE INDEX IF NOT EXISTS idx_jobs_provider_search_key ON jobs (provider_search_key);
CREATE INDEX IF NOT EXISTS idx_jobs_ats_provider ON jobs (ats_provider);
CREATE INDEX IF NOT EXISTS idx_jobs_auto_apply_supported ON jobs (auto_apply_supported);
CREATE INDEX IF NOT EXISTS idx_jobs_manual_fulfillment_ready ON jobs (manual_fulfillment_ready);
CREATE INDEX IF NOT EXISTS idx_jobs_apply_fulfillment_status ON jobs (apply_fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_jobs_validation_status ON jobs (validation_status);
CREATE INDEX IF NOT EXISTS idx_jobs_applyability_tier ON jobs (applyability_tier);
CREATE INDEX IF NOT EXISTS idx_jobs_normalized_title ON jobs (normalized_title);
CREATE INDEX IF NOT EXISTS idx_jobs_normalized_company ON jobs (normalized_company);
-- Fingerprints are intentionally indexed but not unique until existing
-- provider duplicates have been audited and backfilled safely.
CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs (fingerprint);

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
  data JSONB NOT NULL
);
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS ats_provider TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS careers_url TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS discovered_from_url TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS discovered_from_job_id TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS raw_metadata JSONB;
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE ats_company_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_ats_company_sources_provider_source
  ON ats_company_sources (ats_provider, source_key);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_ats_provider ON ats_company_sources (ats_provider);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_source_key ON ats_company_sources (source_key);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_country_code ON ats_company_sources (country_code);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_is_active ON ats_company_sources (is_active);
CREATE INDEX IF NOT EXISTS idx_ats_company_sources_last_checked_at ON ats_company_sources (last_checked_at);

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
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_geo_places_normalized_name ON geo_places(normalized_name);
CREATE INDEX IF NOT EXISTS idx_geo_places_ascii_name ON geo_places(ascii_name);
CREATE INDEX IF NOT EXISTS idx_geo_places_country_code ON geo_places(country_code);
CREATE INDEX IF NOT EXISTS idx_geo_places_population ON geo_places(population);
CREATE INDEX IF NOT EXISTS idx_geo_places_lat_lng ON geo_places(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_geo_places_geoname_id ON geo_places(geoname_id);

CREATE TABLE IF NOT EXISTS swipes (
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_swipes_user_id ON swipes (user_id);

CREATE TABLE IF NOT EXISTS applications (
  application_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications (user_id);

CREATE TABLE IF NOT EXISTS gmail_connections (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  connected BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gmail_connections_email ON gmail_connections (email);

CREATE TABLE IF NOT EXISTS application_emails (
  email_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  application_id TEXT,
  job_id TEXT,
  provider TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  received_at TIMESTAMPTZ,
  classification TEXT,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_emails_user_id ON application_emails (user_id);
CREATE INDEX IF NOT EXISTS idx_application_emails_application_id ON application_emails (application_id);
CREATE INDEX IF NOT EXISTS idx_application_emails_gmail_message_id ON application_emails (gmail_message_id);

CREATE TABLE IF NOT EXISTS company_boards (
  board_id TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT,
  anonymous_id TEXT,
  event TEXT,
  page TEXT,
  source TEXT,
  created_at TIMESTAMPTZ,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created_at ON analytics_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created_at ON analytics_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT,
  created_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type_created_at ON stripe_events (type, created_at DESC);

-- Training platform (separate from core user data): see db/supabase_training_schema.sql
-- Creator invites (training/demo links): see db/supabase_creator_invites_schema.sql
