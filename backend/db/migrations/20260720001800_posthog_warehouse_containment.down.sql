DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'posthog_warehouse_reader')
    AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'analytics_public')
  THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA analytics_public
      REVOKE SELECT ON TABLES FROM posthog_warehouse_reader;
  END IF;
END
$$;

DROP SCHEMA IF EXISTS analytics_public CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'posthog_warehouse_reader'
      AND pg_catalog.shobj_description(oid, 'pg_authid') =
        'managed-by-hirly-migration-20260720001800'
  ) THEN
    DROP ROLE posthog_warehouse_reader;
  END IF;
END
$$;
