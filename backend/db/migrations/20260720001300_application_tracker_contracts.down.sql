DROP FUNCTION IF EXISTS public.patch_user_application_status(text, text, text);
DROP FUNCTION IF EXISTS public.backfill_application_tracker_columns(text, integer);
DROP INDEX CONCURRENTLY IF EXISTS public.applications_generation_queue_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.applications_user_status_updated_idx;
DROP TRIGGER IF EXISTS applications_sync_tracker_columns ON public.applications;
DROP FUNCTION IF EXISTS public.sync_application_tracker_columns();

-- Promoted columns are intentionally retained. Older application code keeps
-- using JSONB, while retaining the additive columns avoids a blocking table
-- rewrite and preserves rollback evidence.
