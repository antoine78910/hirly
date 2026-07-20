BEGIN;
DROP FUNCTION IF EXISTS public.observe_posthog_migration_row(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.accept_posthog_migration_row(uuid, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.mark_posthog_migration_send_started(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.claim_posthog_migration_rows(uuid, text, integer, integer);
DROP TABLE IF EXISTS public.posthog_migration_ledger;
DROP TABLE IF EXISTS public.posthog_migration_runs;
COMMIT;
