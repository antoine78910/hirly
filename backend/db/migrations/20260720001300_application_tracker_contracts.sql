-- Additive, rollback-safe tracker/status contracts. Application JSONB remains
-- authoritative; promoted fields are synchronized in the database.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS generation_status text,
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_application_tracker_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.status := COALESCE(NEW.data ->> 'status', NEW.status);
  NEW.package_status := COALESCE(NEW.data ->> 'package_status', NEW.package_status);
  NEW.submission_status := COALESCE(NEW.data ->> 'submission_status', NEW.submission_status);
  NEW.generation_status := NULLIF(NEW.data ->> 'generation_status', '');
  NEW.generation_started_at := NULLIF(NEW.data ->> 'generation_started_at', '')::timestamptz;
  NEW.generation_completed_at := NULLIF(NEW.data ->> 'generation_completed_at', '')::timestamptz;
  NEW.submitted_at := NULLIF(NEW.data ->> 'submitted_at', '')::timestamptz;
  NEW.status_updated_at := COALESCE(
    NULLIF(NEW.data ->> 'status_updated_at', '')::timestamptz,
    NULLIF(NEW.data ->> 'updated_at', '')::timestamptz,
    NEW.updated_at,
    clock_timestamp()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_sync_tracker_columns ON public.applications;
CREATE TRIGGER applications_sync_tracker_columns
BEFORE INSERT OR UPDATE OF data ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.sync_application_tracker_columns();

UPDATE public.applications SET data = data;

CREATE INDEX IF NOT EXISTS applications_user_status_updated_idx
  ON public.applications (user_id, status_updated_at DESC, application_id);
CREATE INDEX IF NOT EXISTS applications_generation_queue_idx
  ON public.applications (generation_status, generation_started_at, application_id)
  WHERE generation_status IN ('pending_generation', 'generating');

CREATE OR REPLACE FUNCTION public.patch_user_application_status(
  p_application_id text,
  p_user_id text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '2s'
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF p_status NOT IN ('applied', 'viewed', 'interview', 'rejected', 'offer') THEN
    RAISE EXCEPTION 'invalid application status';
  END IF;

  UPDATE public.applications
  SET data = data || jsonb_build_object(
        'status', p_status,
        'status_updated_at', v_now,
        'updated_at', v_now
      ),
      updated_at = v_now
  WHERE application_id = p_application_id
    AND user_id = p_user_id
  RETURNING data INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_user_application_status(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patch_user_application_status(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.patch_user_application_status(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.patch_user_application_status(text, text, text) TO service_role;
