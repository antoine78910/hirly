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
  data JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_provider_external
  ON jobs (provider, external_id)
  WHERE provider IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_data_gin ON jobs USING GIN (data);

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
