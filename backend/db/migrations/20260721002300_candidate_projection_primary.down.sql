-- TEST/LOCAL rollback only. Disable every producer and drain/retain outbox
-- evidence before using this rollback in a deployed environment.
BEGIN;

DROP TRIGGER IF EXISTS candidate_projection_profiles_event ON public.profiles;
DROP TRIGGER IF EXISTS candidate_projection_swipes_event ON public.swipes;
DROP TRIGGER IF EXISTS candidate_projection_applications_event ON public.applications;
DROP TRIGGER IF EXISTS candidate_projection_users_event ON public.users;
DROP TRIGGER IF EXISTS candidate_deletion_tombstone_immutable
  ON public.candidate_deletion_tombstones;
DROP TRIGGER IF EXISTS candidate_serving_control_fail_closed
  ON public.candidate_serving_controls;

DROP FUNCTION IF EXISTS public.ack_candidate_projection_outbox(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.claim_candidate_projection_outbox(text, integer, integer);
DROP FUNCTION IF EXISTS public.begin_candidate_deletion(text, text);
DROP FUNCTION IF EXISTS public.candidate_serving_control_fail_closed();
DROP FUNCTION IF EXISTS public.candidate_deletion_tombstone_immutable();
DROP FUNCTION IF EXISTS public.candidate_projection_emit_row_event();
DROP FUNCTION IF EXISTS public.candidate_projection_next_version(text);

DROP TABLE IF EXISTS public.candidate_projection_outbox;
DROP TABLE IF EXISTS public.candidate_deletion_tombstones;
DROP TABLE IF EXISTS public.candidate_serving_controls;
DROP TABLE IF EXISTS public.candidate_event_versions;
DROP TABLE IF EXISTS public.candidate_projection_runtime_controls;
DROP TABLE IF EXISTS public.candidate_projection_producer_flags;

-- The NOLOGIN role is intentionally retained because deployment credentials
-- may depend on it even when the additive schema is rolled back.
COMMIT;
