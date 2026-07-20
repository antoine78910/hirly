-- Additive auth lookup contract. Application rollout remains gated by
-- AUTH_JOINED_SESSION_LOOKUP_ENABLED.
SET lock_timeout = '2s';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_stripe_customer_id
  ON public.users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_stripe_subscription_id
  ON public.users (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_user_promoted_auth_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.email := NULLIF(lower(btrim(NEW.data ->> 'email')), '');
  NEW.name := NULLIF(btrim(NEW.data ->> 'name'), '');
  NEW.created_at := NULL;
  IF NULLIF(NEW.data ->> 'created_at', '') IS NOT NULL THEN
    BEGIN
      NEW.created_at := (NEW.data ->> 'created_at')::timestamptz;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        NEW.created_at := NULL;
    END;
  END IF;
  NEW.stripe_customer_id := NULLIF(NEW.data #>> '{billing,stripe_customer_id}', '');
  NEW.stripe_subscription_id := NULLIF(NEW.data #>> '{billing,stripe_subscription_id}', '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_promoted_auth_fields ON public.users;
CREATE TRIGGER trg_sync_user_promoted_auth_fields
BEFORE INSERT OR UPDATE OF data ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_promoted_auth_fields();

CREATE OR REPLACE FUNCTION public.backfill_user_promoted_auth_fields(
  p_after_user_id text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
SET lock_timeout = '1s'
AS $$
  WITH selected AS (
    SELECT user_id
    FROM public.users
    WHERE p_after_user_id IS NULL OR user_id > p_after_user_id
    ORDER BY user_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.users AS users
    SET data = users.data
    FROM selected
    WHERE users.user_id = selected.user_id
    RETURNING users.user_id
  )
  SELECT jsonb_build_object(
    'updated', count(*)::integer,
    'next_user_id', max(user_id)
  )
  FROM updated;
$$;

CREATE OR REPLACE FUNCTION public.resolve_auth_session(p_session_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '1s'
AS $$
  SELECT CASE
    WHEN s.session_token IS NULL THEN NULL
    WHEN s.expires_at IS NOT NULL AND s.expires_at <= statement_timestamp() THEN
      jsonb_build_object('status', 'expired')
    WHEN u.user_id IS NULL THEN
      jsonb_build_object('status', 'user_not_found')
    ELSE jsonb_build_object(
      'status', 'ok',
      'user', u.data || jsonb_strip_nulls(jsonb_build_object(
        'user_id', u.user_id,
        'email', u.email,
        'name', u.name,
        'created_at', u.created_at
      )),
      'flags', jsonb_build_object(
        'is_training_creator', EXISTS (
          SELECT 1
          FROM public.training_creators tc
          WHERE tc.user_id = u.user_id
          LIMIT 1
        ),
        'has_training_access',
          lower(COALESCE(u.data ->> 'training_access', 'false'))
            IN ('true', 't', '1', 'yes', 'on'),
        'is_admin',
          lower(COALESCE(u.data ->> 'is_admin', 'false'))
            IN ('true', 't', '1', 'yes', 'on')
      )
    )
  END
  FROM (SELECT p_session_token AS requested_token) requested
  LEFT JOIN public.user_sessions s
    ON s.session_token = requested.requested_token
  LEFT JOIN public.users u
    ON u.user_id = s.user_id;
$$;

CREATE OR REPLACE FUNCTION public.patch_auth_user(p_user_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '2s'
AS $$
  UPDATE public.users
  SET data = data || COALESCE(p_patch, '{}'::jsonb)
  WHERE user_id = p_user_id
    AND jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) = 'object'
  RETURNING data || jsonb_strip_nulls(jsonb_build_object(
    'user_id', user_id,
    'email', email,
    'name', name,
    'created_at', created_at
  ));
$$;

REVOKE ALL ON FUNCTION public.resolve_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patch_auth_user(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_user_promoted_auth_fields(text, integer)
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.resolve_auth_session(text) FROM anon;
    REVOKE ALL ON FUNCTION public.patch_auth_user(text, jsonb) FROM anon;
    REVOKE ALL ON FUNCTION
      public.backfill_user_promoted_auth_fields(text, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.resolve_auth_session(text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.patch_auth_user(text, jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION
      public.backfill_user_promoted_auth_fields(text, integer)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_auth_session(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.patch_auth_user(text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION
      public.backfill_user_promoted_auth_fields(text, integer) TO service_role;
  END IF;
END
$$;

RESET lock_timeout;
