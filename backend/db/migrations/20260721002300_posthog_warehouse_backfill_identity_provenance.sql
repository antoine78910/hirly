-- TS_NEW: expose non-sensitive identity provenance for the dry-run-only importer.
BEGIN;

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
  'server_received_at'::text AS timestamp_quality,
  CASE
    WHEN analytics_events.user_id IS NULL AND analytics_events.anonymous_id IS NOT NULL
      THEN 'anonymous_unlinked'
    WHEN analytics_events.user_id IS NULL
      THEN 'no_identity'
    WHEN mapped_users.canonical_mapping_count = 1
      AND mapped_users.canonical_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN 'canonical_uuid'
    WHEN mapped_users.canonical_user_id IS NOT NULL
      AND mapped_users.canonical_mapping_count > 1
      THEN 'known_user_ambiguous'
    ELSE 'known_user_unresolved'
  END::text AS identity_resolution
FROM public.analytics_events
LEFT JOIN mapped_users
  ON mapped_users.legacy_user_id = analytics_events.user_id::text;

CREATE OR REPLACE VIEW analytics_public.object_manifest_v1
WITH (security_barrier = true)
AS
SELECT object_name, purpose, expected_column_count
FROM (
  VALUES
    ('user_identity_v1', 'canonical identity and allowlisted current person properties', 8),
    ('application_facts_v1', 'operational application facts without document payloads', 8),
    ('swipe_facts_v1', 'persisted swipe facts without document payloads', 5),
    ('legacy_event_history_v1', 'receipt-time legacy history with identity provenance', 9)
) AS manifest(object_name, purpose, expected_column_count);

REVOKE ALL ON analytics_public.legacy_event_history_v1 FROM PUBLIC;
REVOKE ALL ON analytics_public.object_manifest_v1 FROM PUBLIC;
GRANT SELECT ON analytics_public.legacy_event_history_v1 TO posthog_warehouse_reader;
GRANT SELECT ON analytics_public.object_manifest_v1 TO posthog_warehouse_reader;

COMMENT ON VIEW analytics_public.legacy_event_history_v1 IS
  'Receipt-time history with explicit identity provenance. Known users require a unique canonical UUID and never fall back to anonymous attribution.';

COMMIT;
