-- TS_NEW: repair PostHog warehouse projections to expose canonical auth UUIDs.
BEGIN;

CREATE OR REPLACE VIEW analytics_public.user_identity_v1
WITH (security_barrier = true)
AS
WITH mapped_users AS (
  SELECT
    users.*,
    lower(NULLIF(users.data ->> 'supabase_user_id', '')) AS canonical_user_id,
    count(*) OVER (
      PARTITION BY lower(NULLIF(users.data ->> 'supabase_user_id', ''))
    ) AS canonical_mapping_count
  FROM public.users
)
SELECT
  users.canonical_user_id AS user_id,
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
FROM mapped_users AS users
WHERE users.canonical_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND users.canonical_mapping_count = 1;

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

REVOKE ALL ON analytics_public.user_identity_v1 FROM PUBLIC;
REVOKE ALL ON analytics_public.legacy_event_history_v1 FROM PUBLIC;
GRANT SELECT ON analytics_public.user_identity_v1 TO posthog_warehouse_reader;
GRANT SELECT ON analytics_public.legacy_event_history_v1 TO posthog_warehouse_reader;

COMMENT ON VIEW analytics_public.user_identity_v1 IS
  'Canonical lowercase auth UUID projection. Ambiguous or malformed legacy mappings are excluded.';
COMMENT ON VIEW analytics_public.legacy_event_history_v1 IS
  'Warehouse-only receipt-time legacy history mapped only through unique canonical auth UUIDs.';

COMMIT;
