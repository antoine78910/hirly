-- Operational rollback: stop/drain writers before applying.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE EXECUTE ON FUNCTION public.python_provider_work_claim(text, text, integer)
      FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.python_provider_work_heartbeat(uuid, text, integer)
      FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.python_provider_work_finish(uuid, text)
      FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.python_provider_jobs_upsert(uuid, text, jsonb)
      FROM service_role;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.python_provider_work_finish(uuid, text);
DROP FUNCTION IF EXISTS public.python_provider_jobs_upsert(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.python_provider_work_heartbeat(uuid, text, integer);
DROP FUNCTION IF EXISTS public.python_provider_work_claim(text, text, integer);
DROP FUNCTION IF EXISTS worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, uuid, jsonb
);
DROP FUNCTION IF EXISTS worker_private.claim_provider_work(
  uuid, uuid, bigint, text, text, integer
);
DROP FUNCTION IF EXISTS worker_private.transition_provider_writer(
  text, text, text, bigint
);
DROP FUNCTION IF EXISTS worker_private.provider_claim_is_current(uuid, text, text);

GRANT EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, jsonb
) TO hirly_inventory_worker;

DROP TABLE IF EXISTS public.provider_work_claims;
ALTER TABLE public.provider_registry
  DROP CONSTRAINT IF EXISTS provider_registry_ownership_epoch_guard,
  DROP COLUMN IF EXISTS ownership_epoch;

COMMIT;
