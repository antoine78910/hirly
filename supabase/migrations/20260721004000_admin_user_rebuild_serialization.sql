-- Keep the admin answer-fact rebuild atomic per user.  Multiple canonical
-- writes (for example profiles plus analytics) may rebuild one user at the
-- same time; without this lock both transactions can recreate ordinal 0 for
-- the same answer key and violate admin_onboarding_answer_fact_pkey.
DO $$
BEGIN
  IF to_regprocedure('public.admin_rebuild_users_unlocked(text[])') IS NULL THEN
    IF to_regprocedure('public.admin_rebuild_users(text[])') IS NULL THEN
      RAISE EXCEPTION
        'admin read-model base migration must be applied before rebuild serialization';
    END IF;

    ALTER FUNCTION public.admin_rebuild_users(text[])
      RENAME TO admin_rebuild_users_unlocked;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_rebuild_users(p_user_ids text[])
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
  -- Lock in a deterministic order so multi-user rebuilds cannot deadlock.
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
