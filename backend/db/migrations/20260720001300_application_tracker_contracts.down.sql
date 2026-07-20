DROP FUNCTION IF EXISTS public.patch_user_application_status(text, text, text);
DROP INDEX IF EXISTS public.applications_generation_queue_idx;
DROP INDEX IF EXISTS public.applications_user_status_updated_idx;
DROP TRIGGER IF EXISTS applications_sync_tracker_columns ON public.applications;
DROP FUNCTION IF EXISTS public.sync_application_tracker_columns();
ALTER TABLE public.applications
  DROP COLUMN IF EXISTS generation_status,
  DROP COLUMN IF EXISTS generation_started_at,
  DROP COLUMN IF EXISTS generation_completed_at,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS status_updated_at;
