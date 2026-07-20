\set ON_ERROR_STOP on

-- Run only against a disposable database after applying
-- 20260720001800_admin_table_server_pagination.sql.
BEGIN;

INSERT INTO public.users (user_id, email, name, data, created_at, updated_at)
VALUES (
  'admin-malformed-timestamp-user',
  'malformed-timestamp@example.com',
  'Malformed Timestamp',
  '{"updated_at":"not-a-timestamp","last_login_at":"also-invalid"}'::jsonb,
  '2026-07-20T00:00:00Z',
  '2026-07-20T00:00:00Z'
);

INSERT INTO public.profiles (user_id, data, created_at, updated_at)
VALUES (
  'admin-malformed-timestamp-user',
  '{}'::jsonb,
  '2026-07-20T00:00:00Z',
  '2026-07-20T00:00:00Z'
);

INSERT INTO public.swipes (
  swipe_id,
  user_id,
  direction,
  data,
  created_at,
  updated_at
) VALUES (
  'admin-malformed-timestamp-swipe',
  'admin-malformed-timestamp-user',
  'right',
  '{"updated_at":"not-a-timestamp"}'::jsonb,
  '2026-07-20T01:02:03Z',
  '2026-07-20T01:02:03Z'
);

DO $fixture$
DECLARE
  users_payload jsonb := public.admin_users_page_v2(
    100,
    0,
    'malformed-timestamp@example.com',
    false
  );
  analytics_payload jsonb := public.admin_user_analytics_page_v1(
    100,
    0,
    'malformed-timestamp@example.com'
  );
  applications_payload jsonb := public.admin_applications_page_v2(100, 0, NULL);
  analytics_row jsonb;
BEGIN
  SELECT value INTO analytics_row
  FROM jsonb_array_elements(analytics_payload -> 'users')
  WHERE value ->> 'user_id' = 'admin-malformed-timestamp-user';

  IF jsonb_array_length(users_payload -> 'users') <> 1 THEN
    RAISE EXCEPTION 'users RPC unavailable for malformed timestamps: %', users_payload;
  END IF;
  IF analytics_row IS NULL
      OR analytics_row ->> 'last_swipe_at' <> '2026-07-20T01:02:03+00:00' THEN
    RAISE EXCEPTION 'analytics timestamp fallback failed: %', analytics_row;
  END IF;
  IF applications_payload ->> 'contract_version' <> 'admin-applications-page/v2' THEN
    RAISE EXCEPTION 'applications RPC unavailable: %', applications_payload;
  END IF;
END
$fixture$;

ROLLBACK;
