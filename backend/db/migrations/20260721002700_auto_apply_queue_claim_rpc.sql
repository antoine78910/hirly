BEGIN;

CREATE OR REPLACE FUNCTION public.claim_auto_apply_queue()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '2s'
SET lock_timeout = '1s'
AS $$
  WITH claim_clock AS (
    SELECT statement_timestamp() AS claimed_at
  ),
  candidate AS (
    SELECT a.application_id
    FROM public.applications a
    WHERE a.data ->> 'auto_apply_queue_status' = 'queued'
    ORDER BY
      a.data ->> 'auto_apply_queued_at' ASC NULLS LAST,
      a.created_at ASC NULLS LAST,
      a.application_id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.applications a
    SET
      data = a.data || jsonb_build_object(
        'auto_apply_queue_status', 'running',
        'auto_apply_started_at', clock.claimed_at,
        'auto_apply_queue_reason', 'running',
        'updated_at', clock.claimed_at
      ),
      updated_at = clock.claimed_at
    FROM candidate c
    CROSS JOIN claim_clock clock
    WHERE a.application_id = c.application_id
      AND a.data ->> 'auto_apply_queue_status' = 'queued'
    RETURNING a.data, a.application_id, a.user_id, a.job_id
  )
  SELECT updated.data || jsonb_build_object(
    'application_id', updated.application_id,
    'user_id', updated.user_id,
    'job_id', updated.job_id,
    'auto_apply_queue_status', 'running'
  )
  FROM updated;
$$;

DO $acl$
DECLARE
  target_oid oid := 'public.claim_auto_apply_queue()'::regprocedure;
  target_owner oid;
  service_role_oid oid;
  execute_grant record;
BEGIN
  SELECT proowner INTO STRICT target_owner FROM pg_proc WHERE oid = target_oid;
  SELECT oid INTO service_role_oid FROM pg_roles WHERE rolname = 'service_role';
  IF service_role_oid IS NULL THEN
    RAISE EXCEPTION 'required role service_role is missing';
  END IF;

  FOR execute_grant IN
    SELECT DISTINCT acl.grantee, role.rolname
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) acl
    LEFT JOIN pg_roles role ON role.oid = acl.grantee
    WHERE p.oid = target_oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee NOT IN (target_owner, service_role_oid)
  LOOP
    IF execute_grant.grantee = 0 THEN
      REVOKE EXECUTE ON FUNCTION public.claim_auto_apply_queue() FROM PUBLIC;
    ELSIF execute_grant.rolname IS NOT NULL THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.claim_auto_apply_queue() FROM %I',
        execute_grant.rolname
      );
    END IF;
  END LOOP;

  REVOKE ALL ON FUNCTION public.claim_auto_apply_queue() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.claim_auto_apply_queue() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.claim_auto_apply_queue() FROM authenticated;
  END IF;
  GRANT EXECUTE ON FUNCTION public.claim_auto_apply_queue() TO service_role;
END
$acl$;

COMMIT;
