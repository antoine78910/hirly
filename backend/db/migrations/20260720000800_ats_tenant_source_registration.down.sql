BEGIN;

DROP FUNCTION IF EXISTS worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, integer, jsonb
);
DROP FUNCTION IF EXISTS worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, uuid, integer, jsonb
);

COMMIT;
