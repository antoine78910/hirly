\set ON_ERROR_STOP on

-- Run only against a disposable database after applying
-- 20260720001800_admin_table_server_pagination.sql.
BEGIN;
SET LOCAL ROLE service_role;

DO $fixture$
DECLARE
  invalid_call_rejected boolean;
BEGIN
  invalid_call_rejected := false;
  BEGIN
    PERFORM public.admin_users_page_v2(0, 0, NULL, false);
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_call_rejected := true;
  END;
  IF NOT invalid_call_rejected THEN
    RAISE EXCEPTION 'users RPC accepted p_limit=0';
  END IF;

  invalid_call_rejected := false;
  BEGIN
    PERFORM public.admin_user_analytics_page_v1(100, 100001, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_call_rejected := true;
  END;
  IF NOT invalid_call_rejected THEN
    RAISE EXCEPTION 'analytics RPC accepted p_offset=100001';
  END IF;

  invalid_call_rejected := false;
  BEGIN
    PERFORM public.admin_users_page_v2(100, 0, repeat('x', 129), false);
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_call_rejected := true;
  END;
  IF NOT invalid_call_rejected THEN
    RAISE EXCEPTION 'users RPC accepted a 129-character query';
  END IF;

  invalid_call_rejected := false;
  BEGIN
    PERFORM public.admin_applications_page_v2(100, 0, 'not-a-real-filter');
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_call_rejected := true;
  END;
  IF NOT invalid_call_rejected THEN
    RAISE EXCEPTION 'applications RPC accepted an unknown filter';
  END IF;

  PERFORM public.admin_users_page_v2(NULL, NULL, NULL, false);
  PERFORM public.admin_user_analytics_page_v1(200, 100000, repeat('x', 128));
  PERFORM public.admin_applications_page_v2(1, 0, 'all');
END
$fixture$;

ROLLBACK;
