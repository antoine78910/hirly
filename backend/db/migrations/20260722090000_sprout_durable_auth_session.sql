-- TS_MIGRATION: persist encrypted, rotating Sprout auth sessions across worker restarts.
BEGIN;

CREATE TABLE worker_private.sprout_auth_sessions (
  session_key text PRIMARY KEY CHECK (session_key = 'default'),
  version bigint NOT NULL CHECK (version > 0),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 40 AND 32768),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION worker_private.get_sprout_auth_session()
RETURNS TABLE(version bigint, ciphertext text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT session.version, session.ciphertext
  FROM worker_private.sprout_auth_sessions AS session
  WHERE session.session_key = 'default'
$$;

CREATE FUNCTION worker_private.compare_and_swap_sprout_auth_session(
  p_expected_version bigint,
  p_ciphertext text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_version bigint;
BEGIN
  IF p_ciphertext IS NULL OR length(p_ciphertext) < 40 OR length(p_ciphertext) > 32768 THEN
    RAISE EXCEPTION 'invalid Sprout auth session ciphertext' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL THEN
    INSERT INTO worker_private.sprout_auth_sessions (session_key, version, ciphertext)
    VALUES ('default', 1, p_ciphertext)
    ON CONFLICT (session_key) DO NOTHING
    RETURNING version INTO v_version;
    RETURN v_version;
  END IF;

  UPDATE worker_private.sprout_auth_sessions
  SET version = version + 1,
      ciphertext = p_ciphertext,
      updated_at = clock_timestamp()
  WHERE session_key = 'default'
    AND version = p_expected_version
  RETURNING version INTO v_version;
  RETURN v_version;
END
$$;

REVOKE ALL ON worker_private.sprout_auth_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.get_sprout_auth_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.compare_and_swap_sprout_auth_session(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.get_sprout_auth_session() TO hirly_inventory_worker;
GRANT EXECUTE ON FUNCTION worker_private.compare_and_swap_sprout_auth_session(bigint, text) TO hirly_inventory_worker;

COMMIT;
