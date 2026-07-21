BEGIN;

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
WITH mapped_users AS (
  SELECT
    users.user_id::text AS legacy_user_id,
    lower(NULLIF(users.data ->> 'supabase_user_id', '')) AS canonical_user_id,
    count(*) OVER (
      PARTITION BY lower(NULLIF(users.data ->> 'supabase_user_id', ''))
    ) AS canonical_mapping_count
  FROM public.users
),
canonical_users AS (
  SELECT legacy_user_id, canonical_user_id
  FROM mapped_users
  WHERE canonical_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND canonical_mapping_count = 1
)
SELECT
  analytics_events.event_id::text AS source_event_id,
  canonical_users.canonical_user_id AS user_id,
  analytics_events.anonymous_id::text AS anonymous_id,
  analytics_events.event::text AS event_name,
  analytics_events.page::text AS page,
  analytics_events.source::text AS source,
  analytics_events.created_at AS received_at,
  'server_received_at'::text AS timestamp_quality
FROM public.analytics_events
LEFT JOIN canonical_users
  ON canonical_users.legacy_user_id = analytics_events.user_id::text;

REVOKE ALL ON analytics_public.application_facts_v1 FROM PUBLIC;
REVOKE ALL ON analytics_public.swipe_facts_v1 FROM PUBLIC;
REVOKE ALL ON analytics_public.legacy_event_history_v1 FROM PUBLIC;
GRANT SELECT ON analytics_public.application_facts_v1 TO posthog_warehouse_reader;
GRANT SELECT ON analytics_public.swipe_facts_v1 TO posthog_warehouse_reader;
GRANT SELECT ON analytics_public.legacy_event_history_v1 TO posthog_warehouse_reader;

COMMIT;
