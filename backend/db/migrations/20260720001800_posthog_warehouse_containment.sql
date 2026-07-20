-- Narrow, PII-minimized PostHog warehouse projection.
-- The external PostHog connection must use a login that inherits this NOLOGIN role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'posthog_warehouse_reader') THEN
    CREATE ROLE posthog_warehouse_reader NOLOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS analytics_public;
REVOKE ALL ON SCHEMA analytics_public FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics_public TO posthog_warehouse_reader;

CREATE OR REPLACE VIEW analytics_public.user_identity_v1
WITH (security_barrier = true)
AS
SELECT
  users.user_id::text AS user_id,
  users.created_at AS account_created_at,
  NULLIF(users.data #>> '{billing,plan}', '') AS plan,
  CASE
    WHEN lower(COALESCE(users.data #>> '{billing,is_premium}', 'false')) IN ('true', '1', 'yes') THEN true
    ELSE false
  END AS is_premium,
  CASE
    WHEN lower(COALESCE(users.data ->> 'demo_account', 'false')) IN ('true', '1', 'yes') THEN true
    ELSE false
  END AS demo_account,
  NULLIF(left(users.data #>> '{onboarding,state}', 64), '') AS onboarding_state,
  CASE
    WHEN upper(COALESCE(users.data #>> '{location,country_code}', '')) ~ '^[A-Z]{2}$'
      THEN upper(users.data #>> '{location,country_code}')
    ELSE NULL
  END AS country_code,
  CASE
    WHEN lower(COALESCE(users.data ->> 'locale', '')) ~ '^[a-z]{2}([-_][a-z]{2})?$'
      THEN replace(lower(users.data ->> 'locale'), '_', '-')
    ELSE NULL
  END AS locale
FROM public.users;

CREATE OR REPLACE VIEW analytics_public.application_facts_v1
WITH (security_barrier = true)
AS
SELECT
  applications.application_id::text AS application_id,
  applications.user_id::text AS user_id,
  applications.job_id::text AS job_id,
  applications.status::text AS status,
  applications.package_status::text AS package_status,
  applications.submission_status::text AS submission_status,
  applications.created_at,
  applications.updated_at
FROM public.applications;

CREATE OR REPLACE VIEW analytics_public.swipe_facts_v1
WITH (security_barrier = true)
AS
SELECT
  swipes.swipe_id::text AS swipe_id,
  swipes.user_id::text AS user_id,
  swipes.job_id::text AS job_id,
  swipes.direction::text AS direction,
  swipes.created_at
FROM public.swipes;

CREATE OR REPLACE VIEW analytics_public.legacy_event_history_v1
WITH (security_barrier = true)
AS
SELECT
  analytics_events.event_id::text AS source_event_id,
  analytics_events.user_id::text AS user_id,
  analytics_events.anonymous_id::text AS anonymous_id,
  analytics_events.event::text AS event_name,
  analytics_events.page::text AS page,
  analytics_events.source::text AS source,
  analytics_events.created_at AS received_at,
  'server_received_at'::text AS timestamp_quality
FROM public.analytics_events;

CREATE OR REPLACE VIEW analytics_public.object_manifest_v1
WITH (security_barrier = true)
AS
SELECT *
FROM (
  VALUES
    ('user_identity_v1', 'canonical identity and allowlisted current person properties', 8),
    ('application_facts_v1', 'operational application facts without document payloads', 8),
    ('swipe_facts_v1', 'persisted swipe facts without document payloads', 5),
    ('legacy_event_history_v1', 'receipt-time legacy history without property payloads', 8)
) AS manifest(object_name, purpose, expected_column_count);

REVOKE ALL ON ALL TABLES IN SCHEMA analytics_public FROM PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics_public TO posthog_warehouse_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA analytics_public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics_public
  GRANT SELECT ON TABLES TO posthog_warehouse_reader;

COMMENT ON SCHEMA analytics_public IS
  'Explicit allowlist for PostHog warehouse sync; do not synchronize public or auth schemas.';
COMMENT ON VIEW analytics_public.user_identity_v1 IS
  'Canonical user_id projection. Email, name, phone, CV, free text, auth data, and tokens are excluded.';
COMMENT ON VIEW analytics_public.legacy_event_history_v1 IS
  'Warehouse-only receipt-time legacy history; not canonical behavioral chronology.';
