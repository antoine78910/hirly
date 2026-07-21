BEGIN;
DROP FUNCTION IF EXISTS worker_private.record_sprout_ingestion_error(
  uuid, uuid, bigint, text, uuid, text, text, jsonb, jsonb, integer, integer, jsonb
);
DROP TABLE IF EXISTS public.sprout_ingestion_errors;
COMMIT;
