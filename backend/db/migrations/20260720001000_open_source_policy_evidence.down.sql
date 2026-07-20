BEGIN;

DROP TRIGGER IF EXISTS source_policy_evidence_immutable
  ON public.source_policy_evidence;
DROP TABLE IF EXISTS public.source_policy_evidence;
DROP FUNCTION IF EXISTS worker_private.reject_immutable_source_policy_evidence();

COMMIT;
