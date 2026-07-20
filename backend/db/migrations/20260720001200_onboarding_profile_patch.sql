CREATE OR REPLACE FUNCTION public.patch_onboarding_profile(
  p_user_id text,
  p_extras jsonb DEFAULT '{}'::jsonb,
  p_preferences jsonb DEFAULT '{}'::jsonb,
  p_contact jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '2s'
AS $$
  INSERT INTO public.profiles (user_id, data)
  VALUES (
    p_user_id,
    jsonb_build_object('user_id', p_user_id)
      || COALESCE(p_preferences, '{}'::jsonb)
      || jsonb_build_object('extras', COALESCE(p_extras, '{}'::jsonb))
      || jsonb_build_object('contact', COALESCE(p_contact, '{}'::jsonb))
  )
  ON CONFLICT (user_id) DO UPDATE
  SET data =
    public.profiles.data
    || COALESCE(p_preferences, '{}'::jsonb)
    || jsonb_build_object(
      'extras',
      COALESCE(public.profiles.data -> 'extras', '{}'::jsonb)
        || COALESCE(p_extras, '{}'::jsonb)
    )
    || jsonb_build_object(
      'contact',
      COALESCE(public.profiles.data -> 'contact', '{}'::jsonb)
        || COALESCE(p_contact, '{}'::jsonb)
    )
  RETURNING data;
$$;

REVOKE ALL ON FUNCTION public.patch_onboarding_profile(text, jsonb, jsonb, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.patch_onboarding_profile(text, jsonb, jsonb, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.patch_onboarding_profile(text, jsonb, jsonb, jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.patch_onboarding_profile(text, jsonb, jsonb, jsonb) TO service_role;
  END IF;
END
$$;
