CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_user_id text,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '2s'
SET lock_timeout = '1s'
AS $$
  WITH selected AS (
    SELECT notification_id
    FROM public.notifications
    WHERE user_id = p_user_id
      AND lower(COALESCE(data ->> 'read', 'false'))
        NOT IN ('true', 't', '1', 'yes', 'on')
    ORDER BY notification_id
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.notifications n
    SET data = n.data || jsonb_build_object(
      'read', true,
      'updated_at', statement_timestamp()
    )
    FROM selected
    WHERE n.notification_id = selected.notification_id
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.mark_all_notifications_read(text, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.mark_all_notifications_read(text, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(text, integer) TO service_role;
  END IF;
END
$$;
