CREATE OR REPLACE FUNCTION public.apply_gmail_application_outcomes(
  p_user_id text,
  p_updates jsonb
)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $$
  WITH requested AS (
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::jsonb)) AS row(
      application_id text,
      classification text,
      confirmed_at text,
      subject text,
      sender text
    )
    LIMIT 100
  ),
  updated AS (
    UPDATE public.applications a
    SET data = a.data || jsonb_strip_nulls(jsonb_build_object(
      'email_confirmed_outcome', requested.classification,
      'email_confirmed_at', requested.confirmed_at,
      'email_confirmed_subject', requested.subject,
      'email_confirmed_from', requested.sender
    ))
    FROM requested
    WHERE a.application_id = requested.application_id
      AND a.user_id = p_user_id
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.apply_gmail_application_outcomes(text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.apply_gmail_application_outcomes(text, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.apply_gmail_application_outcomes(text, jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_gmail_application_outcomes(text, jsonb) TO service_role;
  END IF;
END
$$;
