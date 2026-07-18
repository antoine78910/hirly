CREATE TABLE IF NOT EXISTS creator_applications (
  creator_application_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creator_applications_email ON creator_applications (email);
