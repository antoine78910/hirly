-- Additive, rollback-safe tracker/status contracts. Application JSONB remains
-- authoritative; promoted fields are synchronized in the database.
SET lock_timeout = '2s';

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS generation_status text,
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_application_tracker_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_field text;
BEGIN
  NEW.status := COALESCE(NEW.data ->> 'status', NEW.status);
  NEW.package_status :=
    COALESCE(NEW.data ->> 'package_status', NEW.package_status);
  NEW.submission_status :=
    COALESCE(NEW.data ->> 'submission_status', NEW.submission_status);
  NEW.generation_status := NULLIF(NEW.data ->> 'generation_status', '');
  NEW.generation_started_at := NULL;
  NEW.generation_completed_at := NULL;
  NEW.submitted_at := NULL;
  NEW.status_updated_at := COALESCE(NEW.updated_at, clock_timestamp());

  FOREACH v_field IN ARRAY ARRAY[
    'generation_started_at',
    'generation_completed_at',
    'submitted_at',
    'status_updated_at',
    'updated_at'
  ] LOOP
    IF NULLIF(NEW.data ->> v_field, '') IS NOT NULL THEN
      BEGIN
        CASE v_field
          WHEN 'generation_started_at' THEN
            NEW.generation_started_at :=
              (NEW.data ->> v_field)::timestamptz;
          WHEN 'generation_completed_at' THEN
            NEW.generation_completed_at :=
              (NEW.data ->> v_field)::timestamptz;
          WHEN 'submitted_at' THEN
            NEW.submitted_at := (NEW.data ->> v_field)::timestamptz;
          WHEN 'status_updated_at' THEN
            NEW.status_updated_at := (NEW.data ->> v_field)::timestamptz;
          WHEN 'updated_at' THEN
            IF NULLIF(NEW.data ->> 'status_updated_at', '') IS NULL THEN
              NEW.status_updated_at := (NEW.data ->> v_field)::timestamptz;
            END IF;
        END CASE;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          NULL;
      END;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_sync_tracker_columns
  ON public.applications;
CREATE TRIGGER applications_sync_tracker_columns
BEFORE INSERT OR UPDATE OF data ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.sync_application_tracker_columns();

-- Existing rows are backfilled explicitly in cursor-bounded batches after the
-- migration. Never lock and rewrite the complete live applications table here.
CREATE OR REPLACE FUNCTION public.backfill_application_tracker_columns(
  p_after_application_id text DEFAULT NULL,
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
    SELECT application_id
    FROM public.applications
    WHERE p_after_application_id IS NULL
      OR application_id > p_after_application_id
    ORDER BY application_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.applications AS applications
    SET data = applications.data
    FROM selected
    WHERE applications.application_id = selected.application_id
    RETURNING applications.application_id
  )
  SELECT jsonb_build_object(
    'updated', count(*)::integer,
    'next_application_id', max(application_id)
  )
  FROM updated;
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS applications_user_status_updated_idx
  ON public.applications (user_id, status_updated_at DESC, application_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS applications_generation_queue_idx
  ON public.applications (
    generation_status,
    generation_started_at,
    application_id
  )
  WHERE generation_status IN ('pending_generation', 'generating');

CREATE OR REPLACE FUNCTION public.patch_user_application_status(
  p_application_id text,
  p_user_id text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '2s'
SET lock_timeout = '1s'
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF p_application_id IS NULL OR length(btrim(p_application_id)) = 0
    OR p_user_id IS NULL OR length(btrim(p_user_id)) = 0
    OR p_status NOT IN (
      'applied', 'viewed', 'interview', 'rejected', 'offer'
    )
  THEN
    RAISE EXCEPTION 'invalid application status patch'
      USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION
  public.patch_user_application_status(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.backfill_application_tracker_columns(text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION
      public.patch_user_application_status(text, text, text) FROM anon;
    REVOKE ALL ON FUNCTION
      public.backfill_application_tracker_columns(text, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION
      public.patch_user_application_status(text, text, text)
      FROM authenticated;
    REVOKE ALL ON FUNCTION
      public.backfill_application_tracker_columns(text, integer)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION
      public.patch_user_application_status(text, text, text)
      TO service_role;
    GRANT EXECUTE ON FUNCTION
      public.backfill_application_tracker_columns(text, integer)
      TO service_role;
  END IF;
END
$$;

RESET lock_timeout;
