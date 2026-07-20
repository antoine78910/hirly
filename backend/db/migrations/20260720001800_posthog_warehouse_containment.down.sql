DROP SCHEMA IF EXISTS analytics_public CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'posthog_warehouse_reader') THEN
    DROP ROLE posthog_warehouse_reader;
  END IF;
END
$$;
