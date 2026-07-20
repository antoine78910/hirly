BEGIN;
DROP FUNCTION IF EXISTS worker_private.write_jobs_and_complete(uuid, uuid, bigint, text, uuid, jsonb);
DROP FUNCTION IF EXISTS worker_private.claim_provider_work(uuid, uuid, bigint, text, text, integer);
DROP TRIGGER IF EXISTS provider_registry_ownership_epoch ON public.provider_registry;
DROP FUNCTION IF EXISTS worker_private.bump_provider_ownership_epoch();
DROP TABLE IF EXISTS public.provider_work_claims;
ALTER TABLE public.provider_registry DROP COLUMN IF EXISTS ownership_epoch;
COMMIT;
