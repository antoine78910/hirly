\set ON_ERROR_STOP on

-- Run only against a disposable database after applying
-- 20260720001800_admin_table_server_pagination.sql.
BEGIN;

INSERT INTO public.applications (
  application_id,
  user_id,
  job_id,
  package_status,
  submission_status,
  status,
  data,
  created_at,
  updated_at
) VALUES
  (
    'admin-package-legacy-resume',
    'admin-package-fixture-user',
    'admin-package-fixture-job',
    NULL,
    'ready',
    'ready',
    '{"tailored_resume":{"summary":"legacy"}}'::jsonb,
    '2099-01-01T00:00:00Z',
    '2099-01-01T00:00:00Z'
  ),
  (
    'admin-package-legacy-cover-letter',
    'admin-package-fixture-user',
    'admin-package-fixture-job',
    NULL,
    'ready',
    'ready',
    '{"cover_letter":{"paragraphs":["legacy"]}}'::jsonb,
    '2099-01-01T00:00:01Z',
    '2099-01-01T00:00:01Z'
  ),
  (
    'admin-package-empty-legacy-documents',
    'admin-package-fixture-user',
    'admin-package-fixture-job',
    NULL,
    'ready',
    'ready',
    '{"tailored_resume":{},"cover_letter":[]}'::jsonb,
    '2099-01-01T00:00:02Z',
    '2099-01-01T00:00:02Z'
  );

DO $fixture$
DECLARE
  payload jsonb := public.admin_applications_page_v2(200, 0, 'prepared');
  resume_row jsonb;
  cover_letter_row jsonb;
  empty_row jsonb;
BEGIN
  SELECT value INTO resume_row
  FROM jsonb_array_elements(payload -> 'applications')
  WHERE value ->> 'application_id' = 'admin-package-legacy-resume';

  SELECT value INTO cover_letter_row
  FROM jsonb_array_elements(payload -> 'applications')
  WHERE value ->> 'application_id' = 'admin-package-legacy-cover-letter';

  SELECT value INTO empty_row
  FROM jsonb_array_elements(payload -> 'applications')
  WHERE value ->> 'application_id' = 'admin-package-empty-legacy-documents';

  IF resume_row IS NULL
      OR resume_row ->> 'package_status' <> 'generated'
      OR resume_row ->> 'has_tailored_resume' <> 'true' THEN
    RAISE EXCEPTION 'legacy tailored_resume package inference failed: %', resume_row;
  END IF;
  IF cover_letter_row IS NULL
      OR cover_letter_row ->> 'package_status' <> 'generated'
      OR cover_letter_row ->> 'has_cover_letter' <> 'true' THEN
    RAISE EXCEPTION 'legacy cover_letter package inference failed: %', cover_letter_row;
  END IF;
  IF empty_row IS NULL
      OR empty_row ->> 'package_status' <> 'not_generated'
      OR empty_row ->> 'has_tailored_resume' <> 'false'
      OR empty_row ->> 'has_cover_letter' <> 'false' THEN
    RAISE EXCEPTION 'empty legacy document inference failed: %', empty_row;
  END IF;
END
$fixture$;

ROLLBACK;
