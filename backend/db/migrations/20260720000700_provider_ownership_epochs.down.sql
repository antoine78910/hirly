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
DROP FUNCTION IF EXISTS worker_private.finish_provider_work(
  uuid, uuid, bigint, text, uuid, text, text, text, timestamptz
);
DROP FUNCTION IF EXISTS worker_private.release_provider_work(
  uuid, uuid, bigint, text, uuid
);
DROP FUNCTION IF EXISTS worker_private.heartbeat_provider_work(
  uuid, uuid, bigint, text, uuid, integer
);
DROP FUNCTION IF EXISTS worker_private.claim_provider_work(
  uuid, uuid, bigint, text, text, integer
);
DROP FUNCTION IF EXISTS worker_private.transition_provider_writer(
  text, text, text, bigint
);
DROP FUNCTION IF EXISTS worker_private.enable_provider_claim_enforcement(text);
DROP FUNCTION IF EXISTS worker_private.provider_claim_is_current(uuid, text, text);
DROP TRIGGER IF EXISTS jobs_claimed_provider_write_guard ON public.jobs;
DROP FUNCTION IF EXISTS worker_private.enforce_claimed_provider_job_write();
DROP TRIGGER IF EXISTS provider_work_claims_immutable
  ON public.provider_work_claims;
DROP FUNCTION IF EXISTS public.enforce_provider_work_claim_history();

GRANT EXECUTE ON FUNCTION worker_private.write_jobs_and_complete(
  uuid, uuid, bigint, text, jsonb
) TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.set_provider_writer(text, text)
  TO hirly_inventory_operator;

DROP TABLE IF EXISTS worker_private.provider_write_transactions;
DROP TABLE IF EXISTS public.provider_work_claims;
ALTER TABLE public.provider_registry
  DROP CONSTRAINT IF EXISTS provider_registry_ownership_epoch_guard,
  DROP COLUMN IF EXISTS claims_required,
  DROP COLUMN IF EXISTS ownership_epoch;

COMMIT;
