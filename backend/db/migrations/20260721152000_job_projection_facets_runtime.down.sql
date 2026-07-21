BEGIN;
REVOKE ALL ON FUNCTION worker_private.complete_job_projection_upsert_with_facets(uuid, uuid, bigint, text, jsonb, text, integer) FROM hirly_matching_projector;
DROP FUNCTION IF EXISTS worker_private.complete_job_projection_upsert_with_facets(uuid, uuid, bigint, text, jsonb, text, integer);
COMMIT;
