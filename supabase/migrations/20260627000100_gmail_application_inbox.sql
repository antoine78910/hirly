CREATE TABLE IF NOT EXISTS public.gmail_connections (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  connected BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gmail_connections_email
  ON public.gmail_connections (email);

CREATE TABLE IF NOT EXISTS public.application_emails (
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

CREATE INDEX IF NOT EXISTS idx_application_emails_user_id
  ON public.application_emails (user_id);

CREATE INDEX IF NOT EXISTS idx_application_emails_application_id
  ON public.application_emails (application_id);

CREATE INDEX IF NOT EXISTS idx_application_emails_gmail_message_id
  ON public.application_emails (gmail_message_id);
