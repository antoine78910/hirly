DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.resolve_auth_session(text) FROM service_role;
    REVOKE ALL ON FUNCTION public.patch_auth_user(text, jsonb) FROM service_role;
    REVOKE ALL ON FUNCTION
      public.backfill_user_promoted_auth_fields(text, integer)
      FROM service_role;
  END IF;
END
$$;
DROP FUNCTION IF EXISTS public.backfill_user_promoted_auth_fields(text, integer);
DROP FUNCTION IF EXISTS public.patch_auth_user(text, jsonb);
DROP FUNCTION IF EXISTS public.resolve_auth_session(text);
DROP TRIGGER IF EXISTS trg_sync_user_promoted_auth_fields ON public.users;
DROP FUNCTION IF EXISTS public.sync_user_promoted_auth_fields();
DROP INDEX CONCURRENTLY IF EXISTS public.idx_users_stripe_subscription_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_users_stripe_customer_id;

-- Promoted columns are intentionally retained during application rollback.
