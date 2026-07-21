BEGIN;

-- Canonical writes from different tables can project the same user concurrently.
-- The original rebuild deletes and recreates answer facts, so serialize that
-- critical section per user instead of allowing two rebuilds to race.
ALTER FUNCTION public.admin_rebuild_users(text[])
  RENAME TO admin_rebuild_users_unlocked;

CREATE FUNCTION public.admin_rebuild_users(p_user_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
SET lock_timeout = '1s'
AS $$
DECLARE
  v_user_id text;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT requested.user_id
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::text[])) AS requested(user_id)
    WHERE requested.user_id IS NOT NULL
    ORDER BY requested.user_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('admin-user-read-model:' || v_user_id, 0)
    );
  END LOOP;

  PERFORM public.admin_rebuild_users_unlocked(p_user_ids);
END
$$;

REVOKE ALL ON FUNCTION public.admin_rebuild_users(text[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_rebuild_users(text[]) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.admin_rebuild_users(text[]) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.admin_rebuild_users(text[]) FROM service_role;
  END IF;
END
$$;

COMMIT;
