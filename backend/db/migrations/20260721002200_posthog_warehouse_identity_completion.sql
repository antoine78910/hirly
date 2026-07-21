-- TS_NEW: complete canonical UUID containment for all user-linked warehouse facts.
BEGIN;

CREATE OR REPLACE VIEW analytics_public.application_facts_v1
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
  applications.application_id::text AS application_id,
  canonical_users.canonical_user_id AS user_id,
  applications.job_id::text AS job_id,
  applications.status::text AS status,
  applications.package_status::text AS package_status,
  applications.submission_status::text AS submission_status,
  applications.created_at,
  applications.updated_at
FROM public.applications
INNER JOIN canonical_users
  ON canonical_users.legacy_user_id = applications.user_id::text;

CREATE OR REPLACE VIEW analytics_public.swipe_facts_v1
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
  swipes.swipe_id::text AS swipe_id,
  canonical_users.canonical_user_id AS user_id,
  swipes.job_id::text AS job_id,
  swipes.direction::text AS direction,
  swipes.created_at
FROM public.swipes
INNER JOIN canonical_users
  ON canonical_users.legacy_user_id = swipes.user_id::text;

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
)
SELECT
  analytics_events.event_id::text AS source_event_id,
  CASE
    WHEN mapped_users.canonical_mapping_count = 1
      AND mapped_users.canonical_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN mapped_users.canonical_user_id
    ELSE NULL
  END AS user_id,
  CASE
    WHEN analytics_events.user_id IS NULL THEN analytics_events.anonymous_id::text
    ELSE NULL
  END AS anonymous_id,
  analytics_events.event::text AS event_name,
  analytics_events.page::text AS page,
  analytics_events.source::text AS source,
  analytics_events.created_at AS received_at,
  'server_received_at'::text AS timestamp_quality
FROM public.analytics_events
LEFT JOIN mapped_users
  ON mapped_users.legacy_user_id = analytics_events.user_id::text;

REVOKE ALL ON analytics_public.application_facts_v1 FROM PUBLIC;
REVOKE ALL ON analytics_public.swipe_facts_v1 FROM PUBLIC;
REVOKE ALL ON analytics_public.legacy_event_history_v1 FROM PUBLIC;
GRANT SELECT ON analytics_public.application_facts_v1 TO posthog_warehouse_reader;
GRANT SELECT ON analytics_public.swipe_facts_v1 TO posthog_warehouse_reader;
GRANT SELECT ON analytics_public.legacy_event_history_v1 TO posthog_warehouse_reader;

COMMENT ON VIEW analytics_public.application_facts_v1 IS
  'Application facts mapped only through unique canonical lowercase auth UUIDs.';
COMMENT ON VIEW analytics_public.swipe_facts_v1 IS
  'Swipe facts mapped only through unique canonical lowercase auth UUIDs.';
COMMENT ON VIEW analytics_public.legacy_event_history_v1 IS
  'Receipt-time history. Known users require a unique canonical UUID; unresolved known mappings cannot fall back to anonymous attribution.';

COMMIT;
