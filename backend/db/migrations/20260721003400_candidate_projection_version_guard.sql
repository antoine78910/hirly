-- TS_MIGRATION: make the polymorphic projection guard safe for both row types.
BEGIN;

CREATE OR REPLACE FUNCTION public.candidate_projection_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.candidate_projection_tombstones
    WHERE candidate_id = NEW.candidate_id
  ) THEN
    RAISE EXCEPTION 'deleted candidate projection cannot be recreated'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- NEW is a polymorphic trigger record. Do not combine table checks with
    -- fields that exist only on the other target table: PostgreSQL resolves
    -- the record field even when the left side of an AND is false.
    IF TG_TABLE_NAME = 'candidate_search_profiles' THEN
      IF NEW.version <= OLD.version THEN
        RAISE EXCEPTION 'candidate profile version must increase'
          USING ERRCODE = '22023';
      END IF;
    ELSIF TG_TABLE_NAME = 'candidate_action_projection' THEN
      IF NEW.candidate_version <= OLD.candidate_version THEN
        RAISE EXCEPTION 'candidate action version must increase'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'candidate projection version guard attached to unsupported table'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
