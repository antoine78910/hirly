-- TS_MIGRATION: whole-provider ownership claims captured before fetch.
-- Claims are fenced by an epoch so ABA transitions (python -> none -> typescript)
-- cannot allow stale work to write canonical inventory.
BEGIN;

ALTER TABLE public.provider_registry
  ADD COLUMN IF NOT EXISTS ownership_epoch bigint NOT NULL DEFAULT 0
    CHECK (ownership_epoch >= 0);

CREATE TABLE IF NOT EXISTS public.provider_work_claims (
  claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.worker_tasks(id) ON DELETE RESTRICT,
  provider text NOT NULL REFERENCES public.provider_registry(provider) ON DELETE RESTRICT,
  runtime text NOT NULL CHECK (runtime IN ('typescript')),
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (task_id, provider)
);

CREATE INDEX IF NOT EXISTS provider_work_claims_active_idx
  ON public.provider_work_claims (provider, ownership_epoch, expires_at);

CREATE OR REPLACE FUNCTION worker_private.bump_provider_ownership_epoch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private AS $$
BEGIN
  IF NEW.writer_runtime IS DISTINCT FROM OLD.writer_runtime THEN
    NEW.ownership_epoch := OLD.ownership_epoch + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_registry_ownership_epoch ON public.provider_registry;
CREATE TRIGGER provider_registry_ownership_epoch
BEFORE UPDATE OF writer_runtime ON public.provider_registry
FOR EACH ROW EXECUTE FUNCTION worker_private.bump_provider_ownership_epoch();

CREATE OR REPLACE FUNCTION worker_private.claim_provider_work(
  p_task_id uuid, p_lease_token uuid, p_claim_generation bigint,
  p_lease_owner text, p_provider text, p_lease_seconds integer
)
RETURNS TABLE(claim_id uuid, provider text, runtime text,
  ownership_epoch bigint, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private AS $$
DECLARE v_task public.worker_tasks; v_registry public.provider_registry;
BEGIN
  IF p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid provider claim lease' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task FROM public.worker_tasks
   WHERE id = p_task_id AND status = 'running' AND provider = p_provider
     AND lease_token = p_lease_token AND claim_generation = p_claim_generation
     AND lease_owner = p_lease_owner AND lease_until > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task lease is not valid' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_registry FROM public.provider_registry WHERE provider = p_provider FOR UPDATE;
  IF NOT FOUND OR NOT v_registry.enabled OR v_registry.writer_runtime <> 'typescript'
     OR v_registry.authorization_status <> 'authorized' THEN
    RAISE EXCEPTION 'provider ownership is not TypeScript' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.provider_work_claims(task_id, provider, runtime, ownership_epoch, expires_at)
  VALUES (p_task_id, p_provider, 'typescript', v_registry.ownership_epoch,
          clock_timestamp() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (task_id, provider) DO UPDATE SET
    ownership_epoch = EXCLUDED.ownership_epoch, expires_at = EXCLUDED.expires_at,
    created_at = clock_timestamp()
  RETURNING provider_work_claims.claim_id, provider_work_claims.provider,
    provider_work_claims.runtime, provider_work_claims.ownership_epoch,
    provider_work_claims.expires_at
  INTO claim_id, provider, runtime, ownership_epoch, expires_at;
  RETURN NEXT;
END $$;

-- Claim-aware overload used by the TS worker. It validates the captured epoch
-- immediately before delegating to the existing canonical writer.
CREATE OR REPLACE FUNCTION worker_private.write_jobs_and_complete(
  p_task_id uuid, p_lease_token uuid, p_claim_generation bigint,
  p_lease_owner text, p_claim_id uuid, p_jobs jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private AS $$
DECLARE v_claim public.provider_work_claims; v_epoch bigint;
BEGIN
  SELECT * INTO v_claim FROM public.provider_work_claims
   WHERE claim_id = p_claim_id AND task_id = p_task_id
     AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider claim is stale' USING ERRCODE = '42501'; END IF;
  SELECT ownership_epoch INTO v_epoch FROM public.provider_registry
   WHERE provider = v_claim.provider AND writer_runtime = 'typescript' AND enabled
     AND authorization_status = 'authorized' FOR UPDATE;
  IF v_epoch IS NULL OR v_epoch <> v_claim.ownership_epoch THEN
    RAISE EXCEPTION 'provider ownership epoch changed' USING ERRCODE = '42501';
  END IF;
  RETURN worker_private.write_jobs_and_complete(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner, p_jobs);
END $$;

REVOKE ALL ON public.provider_work_claims FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.provider_work_claims TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.claim_provider_work(uuid, uuid, bigint, text, text, integer),
  worker_private.write_jobs_and_complete(uuid, uuid, bigint, text, uuid, jsonb)
  TO hirly_inventory_worker;
COMMIT;
