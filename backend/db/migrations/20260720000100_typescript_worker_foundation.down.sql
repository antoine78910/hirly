-- TEST/LOCAL rollback only. Never run automatically in production.
BEGIN;
DROP VIEW IF EXISTS public.worker_capability_status;
DROP SCHEMA IF EXISTS worker_private CASCADE;
DROP FUNCTION IF EXISTS public.worker_private_enforce_attempt_history();
DROP TABLE IF EXISTS public.worker_schedules;
DROP TABLE IF EXISTS public.worker_task_attempts;
DROP TABLE IF EXISTS public.worker_tasks;
DROP TABLE IF EXISTS public.worker_runs;
DROP TABLE IF EXISTS public.provider_registry;
-- Roles are intentionally retained because deployment credentials may depend on them.
COMMIT;
