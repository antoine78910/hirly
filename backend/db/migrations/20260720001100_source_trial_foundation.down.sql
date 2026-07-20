BEGIN;

-- Evidence is append-only. Refuse an accidental rollback that would silently
-- destroy a completed or in-progress trial, including its singular reconciled
-- terminal result; an operator must explicitly archive and remove trial
-- evidence before retrying this down migration.
DO $$
BEGIN
  IF to_regclass('public.source_trial_runs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.source_trial_runs) THEN
      RAISE EXCEPTION
        'source trial evidence exists; refusing destructive rollback'
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION worker_private.record_source_trial_scorecard(
  uuid, text, jsonb
) FROM hirly_source_trial_worker;
REVOKE ALL ON FUNCTION worker_private.record_source_trial_candidate(
  uuid, uuid, text, text, text
) FROM hirly_source_trial_worker;
REVOKE ALL ON FUNCTION worker_private.record_source_trial_page(
  uuid, integer, timestamptz, text, text, bigint
) FROM hirly_source_trial_worker;
REVOKE ALL ON FUNCTION worker_private.begin_source_trial(jsonb)
  FROM hirly_source_trial_worker;

DROP FUNCTION IF EXISTS worker_private.record_source_trial_scorecard(
  uuid, text, jsonb
);
DROP FUNCTION IF EXISTS worker_private.record_source_trial_candidate(
  uuid, uuid, text, text, text
);
DROP FUNCTION IF EXISTS worker_private.record_source_trial_page(
  uuid, integer, timestamptz, text, text, bigint
);
DROP FUNCTION IF EXISTS worker_private.begin_source_trial(jsonb);
DROP FUNCTION IF EXISTS worker_private.source_trial_run_is_writable(uuid);

DROP TRIGGER IF EXISTS source_trial_scorecards_immutable
  ON public.source_trial_scorecards;
DROP TRIGGER IF EXISTS source_trial_candidates_immutable
  ON public.source_trial_candidates;
DROP TRIGGER IF EXISTS source_trial_pages_immutable
  ON public.source_trial_pages;
DROP TRIGGER IF EXISTS source_trial_runs_immutable
  ON public.source_trial_runs;
DROP TABLE IF EXISTS public.source_trial_scorecards;
DROP TABLE IF EXISTS public.source_trial_candidates;
DROP TABLE IF EXISTS public.source_trial_pages;
DROP TABLE IF EXISTS public.source_trial_runs;

DROP TRIGGER IF EXISTS source_trial_policy_guard
  ON public.source_trial_policies;
DROP TABLE IF EXISTS public.source_trial_policies;

DROP FUNCTION IF EXISTS worker_private.reject_immutable_source_trial_evidence();
DROP FUNCTION IF EXISTS worker_private.enforce_source_trial_policy();
DROP FUNCTION IF EXISTS worker_private.source_policy_evidence_allows_trial(
  uuid, text, text, text, text, text
);

-- Cluster roles are intentionally not dropped by schema rollback. Credentials
-- or memberships may exist outside this migration's transactional ownership.
COMMIT;
