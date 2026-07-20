-- TS_NEW: immutable qualification evidence for disabled French open-data sources.
-- These records are references to reviewed repository artifacts, not production
-- authorization. They do not register providers, enable transports, or grant
-- canonical writer ownership.
BEGIN;

CREATE TABLE IF NOT EXISTS public.source_policy_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL CHECK (length(btrim(source_key)) > 0),
  evidence_key text NOT NULL CHECK (length(btrim(evidence_key)) > 0),
  evidence_type text NOT NULL CHECK (
    evidence_type IN ('qualification_manifest', 'dataset_page', 'licence_text', 'written_permission')
  ),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) > 0),
  artifact_path text NOT NULL CHECK (length(btrim(artifact_path)) > 0),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  qualification_status text NOT NULL CHECK (
    qualification_status IN (
      'requires_legal_review',
      'dataset_specific_evidence_required',
      'approved',
      'blocked'
    )
  ),
  production_eligible boolean NOT NULL DEFAULT false,
  claim_scope jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(claim_scope) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_policy_evidence_identity_unique
    UNIQUE (source_key, evidence_key),
  CONSTRAINT source_policy_evidence_approval_guard CHECK (
    qualification_status <> 'approved' OR production_eligible
  )
);

CREATE OR REPLACE FUNCTION worker_private.reject_immutable_source_policy_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'source policy evidence is immutable' USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS source_policy_evidence_immutable
  ON public.source_policy_evidence;
CREATE TRIGGER source_policy_evidence_immutable
BEFORE UPDATE OR DELETE ON public.source_policy_evidence
FOR EACH ROW
EXECUTE FUNCTION worker_private.reject_immutable_source_policy_evidence();

INSERT INTO public.source_policy_evidence (
  source_key,
  evidence_key,
  evidence_type,
  evidence_reference,
  artifact_path,
  artifact_sha256,
  captured_at,
  qualification_status,
  production_eligible,
  claim_scope
)
VALUES
  (
    'choisir-le-service-public',
    'approved-plan-qualification-2026-07-20',
    'qualification_manifest',
    'https://www.data.gouv.fr/datasets/les-offres-diffusees-sur-choisir-le-service-public',
    'artifacts/job-ingestion/source-policy/choisir-le-service-public.json',
    'a8314b70dfeac6ec0ac0152f1f4436fd9fa8321f4ef35bb1c94ce4483061e0b7',
    '2026-07-20T00:00:00Z',
    'requires_legal_review',
    false,
    '{"planStatementOnly":true,"liveEvidenceCaptured":false}'::jsonb
  ),
  (
    'bpce-open-feed',
    'approved-plan-qualification-2026-07-20',
    'qualification_manifest',
    'https://www.data.gouv.fr/datasets/groupe-bpce-offres-emploi-publiques',
    'artifacts/job-ingestion/source-policy/bpce-open-feed.json',
    '270dd53e7d5fbdef3abbeedac5ce3c962279026880f836352692823e73173cc4',
    '2026-07-20T00:00:00Z',
    'requires_legal_review',
    false,
    '{"planStatementOnly":true,"liveEvidenceCaptured":false}'::jsonb
  ),
  (
    'data-gouv-generic',
    'approved-plan-qualification-2026-07-20',
    'qualification_manifest',
    'https://www.data.gouv.fr/datasets/catalogue-des-donnees-de-data-gouv-fr',
    'artifacts/job-ingestion/source-policy/data-gouv-generic.json',
    '57f93b51ea4dd30c23ee2d77d78728a00525c7b85f1b5e194d981ee4ce5ed6a8',
    '2026-07-20T00:00:00Z',
    'dataset_specific_evidence_required',
    false,
    '{"planStatementOnly":true,"liveEvidenceCaptured":false}'::jsonb
  )
ON CONFLICT (source_key, evidence_key) DO NOTHING;

REVOKE ALL ON public.source_policy_evidence FROM PUBLIC;
GRANT SELECT ON public.source_policy_evidence TO hirly_inventory_operator;

COMMIT;
