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

CREATE TABLE IF NOT EXISTS company_boards (
  board_id TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
