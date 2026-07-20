-- TS_NEW: bind every evidence-only source trial to the measured tenant-selection artifact.
-- This migration adds no canonical writer, source activation, or network capability.

ALTER TABLE public.source_trial_policies
  ADD COLUMN IF NOT EXISTS tenant_selection_evidence_reference text,
  ADD COLUMN IF NOT EXISTS tenant_selection_evidence_sha256 text;

ALTER TABLE public.source_trial_policies
  DROP CONSTRAINT IF EXISTS source_trial_policies_tenant_selection_pair_guard;
ALTER TABLE public.source_trial_policies
  ADD CONSTRAINT source_trial_policies_tenant_selection_pair_guard CHECK (
    (
      tenant_selection_evidence_reference IS NULL
      AND tenant_selection_evidence_sha256 IS NULL
    )
    OR (
      length(btrim(tenant_selection_evidence_reference)) BETWEEN 1 AND 2048
      AND tenant_selection_evidence_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE public.source_trial_policies
  DROP CONSTRAINT IF EXISTS source_trial_policies_tenant_selection_enablement_guard;
ALTER TABLE public.source_trial_policies
  ADD CONSTRAINT source_trial_policies_tenant_selection_enablement_guard CHECK (
    NOT trial_enabled
    OR (
      tenant_selection_evidence_reference IS NOT NULL
      AND tenant_selection_evidence_sha256 IS NOT NULL
    )
  );

ALTER TABLE public.source_trial_runs
  ADD COLUMN IF NOT EXISTS tenant_selection_evidence_reference text,
  ADD COLUMN IF NOT EXISTS tenant_selection_evidence_sha256 text;

ALTER TABLE public.source_trial_runs
  DROP CONSTRAINT IF EXISTS source_trial_runs_tenant_selection_pair_guard;
ALTER TABLE public.source_trial_runs
  ADD CONSTRAINT source_trial_runs_tenant_selection_pair_guard CHECK (
    (
      tenant_selection_evidence_reference IS NULL
      AND tenant_selection_evidence_sha256 IS NULL
    )
    OR (
      length(btrim(tenant_selection_evidence_reference)) BETWEEN 1 AND 2048
      AND tenant_selection_evidence_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

CREATE OR REPLACE FUNCTION worker_private.bind_source_trial_tenant_selection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_policy public.source_trial_policies;
  v_reference text;
  v_sha256 text;
BEGIN
  IF jsonb_typeof(NEW.manifest->'tenantSelectionEvidence') <> 'object' THEN
    RAISE EXCEPTION
      'source trial manifest requires measured tenant selection evidence'
      USING ERRCODE = '22023';
  END IF;

  v_reference := btrim(
    NEW.manifest#>>'{tenantSelectionEvidence,reference}'
  );
  v_sha256 := NEW.manifest#>>'{tenantSelectionEvidence,sha256}';

  SELECT policy.*
  INTO v_policy
  FROM public.source_trial_policies AS policy
  WHERE policy.id = NEW.policy_id;

  IF v_policy.id IS NULL
    OR v_reference IS NULL
    OR length(v_reference) NOT BETWEEN 1 AND 2048
    OR v_sha256 IS NULL
    OR v_sha256 !~ '^[0-9a-f]{64}$'
    OR v_policy.tenant_selection_evidence_reference IS DISTINCT FROM v_reference
    OR v_policy.tenant_selection_evidence_sha256 IS DISTINCT FROM v_sha256
  THEN
    RAISE EXCEPTION
      'source trial tenant selection evidence does not match approved policy'
      USING ERRCODE = '42501';
  END IF;

  NEW.tenant_selection_evidence_reference := v_reference;
  NEW.tenant_selection_evidence_sha256 := v_sha256;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_trial_run_tenant_selection_guard
  ON public.source_trial_runs;
CREATE TRIGGER source_trial_run_tenant_selection_guard
BEFORE INSERT ON public.source_trial_runs
FOR EACH ROW
EXECUTE FUNCTION worker_private.bind_source_trial_tenant_selection();

CREATE OR REPLACE FUNCTION worker_private.prevent_source_trial_selection_rebinding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (
    OLD.tenant_selection_evidence_reference
      IS DISTINCT FROM NEW.tenant_selection_evidence_reference
    OR OLD.tenant_selection_evidence_sha256
      IS DISTINCT FROM NEW.tenant_selection_evidence_sha256
  ) AND EXISTS (
    SELECT 1
    FROM public.source_trial_runs AS run
    WHERE run.policy_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'source trial tenant selection evidence is already bound to a run'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_trial_policy_selection_immutable_after_run
  ON public.source_trial_policies;
CREATE TRIGGER source_trial_policy_selection_immutable_after_run
BEFORE UPDATE ON public.source_trial_policies
FOR EACH ROW
EXECUTE FUNCTION worker_private.prevent_source_trial_selection_rebinding();
