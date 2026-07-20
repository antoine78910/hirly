\set ON_ERROR_STOP on

-- This file is intentionally a smoke companion, not the release plan harness.
-- EXPLAIN on a SQL function call exposes only an opaque Result node. Use:
--
--   python tests/run_admin_pagination_plan_harness.py \
--     --database-url "$ADMIN_PAGINATION_TEST_DATABASE_URL" \
--     --output /tmp/admin-pagination-plan-results.json
--
-- The release harness captures cursor RPC plans plus catalog/index evidence.

SELECT
  pg_column_size(public.admin_users_cursor_v3(200, NULL, NULL, 'next', NULL, false)) AS users_payload_bytes,
  pg_column_size(public.admin_user_analytics_cursor_v2(200, NULL, NULL, 'next', NULL)) AS analytics_payload_bytes,
  pg_column_size(public.admin_applications_cursor_v3(200, NULL, NULL, 'next', NULL)) AS applications_payload_bytes;
