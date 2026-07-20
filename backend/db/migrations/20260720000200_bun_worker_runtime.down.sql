-- TEST/LOCAL rollback only. Never run automatically in production.
BEGIN;
DROP FUNCTION IF EXISTS worker_private.get_run(uuid);
DROP FUNCTION IF EXISTS worker_private.list_due_schedules(integer);
DROP FUNCTION IF EXISTS worker_private.provider_runnable(text);
COMMIT;
