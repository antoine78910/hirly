CREATE OR REPLACE FUNCTION public.apply_gmail_application_outcomes(
  p_user_id text,
  p_updates jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
SET lock_timeout = '1s'
AS $$
DECLARE
  v_updated integer;
  v_requested integer;
BEGIN
  IF p_user_id IS NULL OR length(btrim(p_user_id)) = 0
    OR p_updates IS NULL
    OR jsonb_typeof(p_updates) <> 'array'
    OR jsonb_array_length(p_updates) > 100
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_updates) AS item
      WHERE jsonb_typeof(item) <> 'object'
    )
  THEN
    RAISE EXCEPTION 'invalid Gmail application outcome batch'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO v_requested
  FROM jsonb_to_recordset(p_updates) AS row(
    application_id text,
    classification text,
    confirmed_at text,
    subject text,
    sender text
  )
  WHERE row.application_id IS NOT NULL
    AND length(btrim(row.application_id)) > 0
    AND row.classification IN (
      'primary',
      'verification',
      'confirmation',
      'status',
      'interview',
      'offer'
    )
    AND row.confirmed_at IS NOT NULL
    AND row.confirmed_at::timestamptz IS NOT NULL;

  IF v_requested <> jsonb_array_length(p_updates)
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_updates) AS row(application_id text)
      GROUP BY row.application_id
      HAVING count(*) > 1
    )
  THEN
    RAISE EXCEPTION
      'Gmail application outcome batch contains invalid or duplicate rows'
      USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT
      row.application_id,
      row.classification,
      row.confirmed_at::timestamptz AS confirmed_at,
      left(row.subject, 998) AS subject,
      left(row.sender, 320) AS sender
    FROM jsonb_to_recordset(p_updates) AS row(
      application_id text,
      classification text,
      confirmed_at text,
      subject text,
      sender text
    )
    WHERE row.application_id IS NOT NULL
      AND length(btrim(row.application_id)) > 0
      AND row.classification IN (
        'primary',
        'verification',
        'confirmation',
        'status',
        'interview',
        'offer'
      )
      AND row.confirmed_at IS NOT NULL
  ),
  updated AS (
    UPDATE public.applications AS application
    SET data = application.data || jsonb_strip_nulls(jsonb_build_object(
      'email_confirmed_outcome', requested.classification,
      'email_confirmed_at', requested.confirmed_at,
      'email_confirmed_subject', requested.subject,
      'email_confirmed_from', requested.sender
    ))
    FROM requested
    WHERE application.application_id = requested.application_id
      AND application.user_id = p_user_id
      AND array_position(
        ARRAY[
          'primary',
          'verification',
          'confirmation',
          'status',
          'interview',
          'offer'
        ],
        requested.classification
      ) >= COALESCE(
        array_position(
          ARRAY[
            'primary',
            'verification',
            'confirmation',
            'status',
            'interview',
            'offer'
          ],
          application.data ->> 'email_confirmed_outcome'
        ),
        0
      )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION
  public.apply_gmail_application_outcomes(text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION
      public.apply_gmail_application_outcomes(text, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION
      public.apply_gmail_application_outcomes(text, jsonb)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION
      public.apply_gmail_application_outcomes(text, jsonb)
      TO service_role;
  END IF;
END
$$;
