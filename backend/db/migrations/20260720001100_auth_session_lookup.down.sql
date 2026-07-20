REVOKE ALL ON FUNCTION public.resolve_auth_session(text) FROM service_role;
DROP FUNCTION IF EXISTS public.resolve_auth_session(text);
DROP TRIGGER IF EXISTS trg_sync_user_promoted_auth_fields ON public.users;
DROP FUNCTION IF EXISTS public.sync_user_promoted_auth_fields();
DROP INDEX IF EXISTS public.idx_users_stripe_subscription_id;
DROP INDEX IF EXISTS public.idx_users_stripe_customer_id;

-- Promoted columns are intentionally retained during application rollback.
