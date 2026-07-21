-- TEST/LOCAL rollback only. Disable serving/projectors and preserve canonical
-- jobs. This removes only additive common matching projections.
BEGIN;

DROP FUNCTION IF EXISTS public.read_candidate_action_aliases(text);
DROP FUNCTION IF EXISTS public.read_candidate_actions(text);
DROP FUNCTION IF EXISTS public.read_candidate_search_profile(text);
DROP FUNCTION IF EXISTS public.candidate_group_is_excluded(text, uuid);
DROP FUNCTION IF EXISTS public.apply_candidate_projection_tombstone(text, bigint, uuid, timestamptz);
DROP TRIGGER IF EXISTS candidate_projection_tombstone_guard
  ON public.candidate_projection_tombstones;
DROP FUNCTION IF EXISTS public.candidate_projection_tombstone_guard();
DROP TRIGGER IF EXISTS candidate_action_group_alias_guard
  ON public.candidate_action_group_aliases;
DROP FUNCTION IF EXISTS public.candidate_action_group_alias_guard();
DROP TRIGGER IF EXISTS candidate_action_projection_version_guard
  ON public.candidate_action_projection;
DROP TRIGGER IF EXISTS candidate_search_profiles_version_guard
  ON public.candidate_search_profiles;
DROP FUNCTION IF EXISTS public.candidate_projection_version_guard();

DROP TABLE IF EXISTS public.projection_reconciliation_tasks;
DROP TABLE IF EXISTS public.job_search_documents;
DROP TABLE IF EXISTS public.candidate_action_projection;
DROP TABLE IF EXISTS public.candidate_action_group_aliases;
DROP TABLE IF EXISTS public.candidate_search_profiles;
DROP TABLE IF EXISTS public.candidate_projection_tombstones;
DROP TABLE IF EXISTS public.matching_runtime_controls;

-- NOLOGIN roles are intentionally retained for deployment credential safety.
COMMIT;
