BEGIN;

DROP FUNCTION IF EXISTS worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, uuid, interval, jsonb
);

COMMIT;
