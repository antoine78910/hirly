DROP TRIGGER IF EXISTS source_trial_policy_selection_immutable_after_run
  ON public.source_trial_policies;
DROP FUNCTION IF EXISTS worker_private.prevent_source_trial_selection_rebinding();

DROP TRIGGER IF EXISTS source_trial_run_tenant_selection_guard
  ON public.source_trial_runs;
DROP FUNCTION IF EXISTS worker_private.bind_source_trial_tenant_selection();

ALTER TABLE public.source_trial_runs
  DROP CONSTRAINT IF EXISTS source_trial_runs_tenant_selection_pair_guard,
  DROP COLUMN IF EXISTS tenant_selection_evidence_sha256,
  DROP COLUMN IF EXISTS tenant_selection_evidence_reference;

ALTER TABLE public.source_trial_policies
  DROP CONSTRAINT IF EXISTS source_trial_policies_tenant_selection_enablement_guard,
  DROP CONSTRAINT IF EXISTS source_trial_policies_tenant_selection_pair_guard,
  DROP COLUMN IF EXISTS tenant_selection_evidence_sha256,
  DROP COLUMN IF EXISTS tenant_selection_evidence_reference;
