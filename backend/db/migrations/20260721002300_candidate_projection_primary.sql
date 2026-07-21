-- Primary database only: atomic, opaque candidate projection events.
-- Wire contract v1 keeps profiles/swipes/applications/users/deletion families
-- and insert/update/delete operations.
-- Producers and relay are installed disabled; applying this migration does not
-- change the authoritative Python writers or activate cross-database traffic.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'hirly_candidate_projection_relay'
  ) THEN
    CREATE ROLE hirly_candidate_projection_relay NOLOGIN NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE TABLE public.candidate_projection_producer_flags (
  entity_family text PRIMARY KEY
    CHECK (entity_family IN ('profiles', 'swipes', 'applications', 'users')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL DEFAULT current_user
);

INSERT INTO public.candidate_projection_producer_flags (entity_family)
VALUES ('profiles'), ('swipes'), ('applications'), ('users')
ON CONFLICT (entity_family) DO NOTHING;

CREATE TABLE public.candidate_projection_runtime_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  relay_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL DEFAULT current_user
);

INSERT INTO public.candidate_projection_runtime_controls (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE public.candidate_event_versions (
  candidate_id text PRIMARY KEY CHECK (length(btrim(candidate_id)) > 0),
  current_version bigint NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.candidate_serving_controls (
  candidate_id text PRIMARY KEY CHECK (length(btrim(candidate_id)) > 0),
  serving_disabled boolean NOT NULL DEFAULT false,
  disabled_reason text CHECK (
    disabled_reason IS NULL OR disabled_reason IN ('deletion', 'consent', 'operator')
  ),
  control_version bigint NOT NULL CHECK (control_version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT candidate_serving_controls_reason_guard CHECK (
    serving_disabled OR disabled_reason IS NULL
  )
);

CREATE TABLE public.candidate_deletion_tombstones (
  candidate_id text PRIMARY KEY CHECK (length(btrim(candidate_id)) > 0),
  deletion_version bigint NOT NULL CHECK (deletion_version > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
  serving_disabled boolean NOT NULL DEFAULT true CHECK (serving_disabled),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.candidate_projection_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id text NOT NULL CHECK (length(btrim(candidate_id)) > 0),
  candidate_version bigint NOT NULL CHECK (candidate_version > 0),
  entity_family text NOT NULL CHECK (
    entity_family IN ('profiles', 'swipes', 'applications', 'users', 'deletion')
  ),
  entity_id text NOT NULL CHECK (length(btrim(entity_id)) > 0),
  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  event_key text NOT NULL UNIQUE CHECK (length(btrim(event_key)) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_token uuid,
  lease_until timestamptz,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  CONSTRAINT candidate_projection_outbox_lease_shape CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);

CREATE INDEX candidate_projection_outbox_ready_idx
  ON public.candidate_projection_outbox (available_at, event_id)
  WHERE delivered_at IS NULL;
CREATE INDEX candidate_projection_outbox_candidate_version_idx
  ON public.candidate_projection_outbox (candidate_id, candidate_version);
CREATE INDEX candidate_projection_outbox_expired_lease_idx
  ON public.candidate_projection_outbox (lease_until, event_id)
  WHERE delivered_at IS NULL AND lease_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.candidate_projection_next_version(
  p_candidate_id text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_version bigint;
BEGIN
  IF p_candidate_id IS NULL OR length(btrim(p_candidate_id)) = 0 THEN
    RAISE EXCEPTION 'candidate id is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.candidate_event_versions (candidate_id, current_version)
  VALUES (p_candidate_id, 1)
  ON CONFLICT (candidate_id) DO UPDATE SET
    current_version = candidate_event_versions.current_version + 1,
    updated_at = clock_timestamp()
  RETURNING current_version INTO v_version;
  RETURN v_version;
END
$$;

CREATE OR REPLACE FUNCTION public.candidate_projection_emit_row_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_candidate_id text;
  v_entity_id text;
  v_entity_family text := TG_TABLE_NAME;
  v_operation text := lower(TG_OP);
  v_version bigint;
BEGIN
  IF NOT coalesce((
    SELECT enabled
    FROM public.candidate_projection_producer_flags
    WHERE entity_family = TG_TABLE_NAME
  ), false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_candidate_id := v_row->>'user_id';
  IF v_candidate_id IS NULL OR length(btrim(v_candidate_id)) = 0 THEN
    RAISE EXCEPTION 'candidate projection source row lacks user_id'
      USING ERRCODE = '23502';
  END IF;

  -- Cleanup after a committed tombstone must not create a newer event that can
  -- be mistaken for a resurrection. The tombstone is the terminal source event.
  IF EXISTS (
    SELECT 1 FROM public.candidate_deletion_tombstones
    WHERE candidate_id = v_candidate_id
  ) THEN
    IF TG_TABLE_NAME = 'users' AND TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_TABLE_NAME = 'users' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user deletion must use begin_candidate_deletion first'
      USING ERRCODE = '55000';
  END IF;

  v_entity_id := CASE TG_TABLE_NAME
    WHEN 'profiles' THEN v_candidate_id
    WHEN 'users' THEN v_candidate_id
    WHEN 'applications' THEN v_row->>'application_id'
    WHEN 'swipes' THEN v_candidate_id || ':' || coalesce(v_row->>'job_id', 'unknown')
  END;
  v_version := public.candidate_projection_next_version(v_candidate_id);

  INSERT INTO public.candidate_projection_outbox (
    candidate_id, candidate_version, entity_family, entity_id, operation, event_key
  ) VALUES (
    v_candidate_id,
    v_version,
    v_entity_family,
    v_entity_id,
    v_operation,
    v_entity_family || ':' || v_entity_id || ':' || v_version::text || ':' || v_operation
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS candidate_projection_profiles_event ON public.profiles;
CREATE TRIGGER candidate_projection_profiles_event
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_emit_row_event();

DROP TRIGGER IF EXISTS candidate_projection_swipes_event ON public.swipes;
CREATE TRIGGER candidate_projection_swipes_event
AFTER INSERT OR UPDATE OR DELETE ON public.swipes
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_emit_row_event();

DROP TRIGGER IF EXISTS candidate_projection_applications_event ON public.applications;
CREATE TRIGGER candidate_projection_applications_event
AFTER INSERT OR UPDATE OR DELETE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_emit_row_event();

DROP TRIGGER IF EXISTS candidate_projection_users_event ON public.users;
CREATE TRIGGER candidate_projection_users_event
AFTER INSERT OR UPDATE OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.candidate_projection_emit_row_event();

CREATE OR REPLACE FUNCTION public.candidate_deletion_tombstone_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candidate deletion tombstones cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
    OR NEW.deletion_version IS DISTINCT FROM OLD.deletion_version
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.serving_disabled IS DISTINCT FROM true
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'candidate deletion tombstones are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_deletion_tombstone_immutable
BEFORE UPDATE OR DELETE ON public.candidate_deletion_tombstones
FOR EACH ROW EXECUTE FUNCTION public.candidate_deletion_tombstone_immutable();

CREATE OR REPLACE FUNCTION public.candidate_serving_control_fail_closed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.disabled_reason = 'deletion' AND (
    NOT NEW.serving_disabled
    OR NEW.disabled_reason IS DISTINCT FROM 'deletion'
    OR NEW.control_version < OLD.control_version
  ) THEN
    RAISE EXCEPTION 'deletion serving control cannot be lowered or re-enabled'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_serving_control_fail_closed
BEFORE UPDATE ON public.candidate_serving_controls
FOR EACH ROW EXECUTE FUNCTION public.candidate_serving_control_fail_closed();

CREATE OR REPLACE FUNCTION public.begin_candidate_deletion(
  p_user_id text,
  p_idempotency_key text
)
RETURNS public.candidate_deletion_tombstones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.candidate_deletion_tombstones;
  v_version bigint;
  v_result public.candidate_deletion_tombstones;
BEGIN
  IF p_user_id IS NULL OR length(btrim(p_user_id)) = 0
    OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0
  THEN
    RAISE EXCEPTION 'user id and idempotency key are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.candidate_deletion_tombstones
  WHERE candidate_id = p_user_id
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_existing;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.candidate_deletion_tombstones
    WHERE idempotency_key = p_idempotency_key AND candidate_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'idempotency key belongs to another candidate'
      USING ERRCODE = '23505';
  END IF;

  v_version := public.candidate_projection_next_version(p_user_id);
  INSERT INTO public.candidate_serving_controls (
    candidate_id, serving_disabled, disabled_reason, control_version
  ) VALUES (p_user_id, true, 'deletion', v_version)
  ON CONFLICT (candidate_id) DO UPDATE SET
    serving_disabled = true,
    disabled_reason = 'deletion',
    control_version = greatest(candidate_serving_controls.control_version, EXCLUDED.control_version),
    updated_at = clock_timestamp();

  INSERT INTO public.candidate_deletion_tombstones (
    candidate_id, deletion_version, idempotency_key
  ) VALUES (p_user_id, v_version, p_idempotency_key)
  RETURNING * INTO v_result;

  INSERT INTO public.candidate_projection_outbox (
    candidate_id, candidate_version, entity_family, entity_id, operation, event_key
  ) VALUES (
    p_user_id, v_version, 'deletion', p_user_id, 'delete',
    'deletion:' || p_user_id || ':' || v_version::text || ':delete'
  );
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_candidate_projection_outbox(
  p_lease_owner text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS SETOF public.candidate_projection_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF length(btrim(coalesce(p_lease_owner, ''))) = 0
    OR p_limit NOT BETWEEN 1 AND 500
    OR p_lease_seconds NOT BETWEEN 5 AND 3600
  THEN
    RAISE EXCEPTION 'invalid outbox claim parameters' USING ERRCODE = '22023';
  END IF;
  IF NOT (SELECT relay_enabled FROM public.candidate_projection_runtime_controls WHERE singleton) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT event_id
    FROM public.candidate_projection_outbox
    WHERE delivered_at IS NULL
      AND available_at <= clock_timestamp()
      AND (lease_until IS NULL OR lease_until <= clock_timestamp())
    ORDER BY available_at, event_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.candidate_projection_outbox AS event
  SET lease_owner = p_lease_owner,
      lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = event.attempts + 1
  FROM candidates
  WHERE event.event_id = candidates.event_id
  RETURNING event.*;
END
$$;

CREATE OR REPLACE FUNCTION public.ack_candidate_projection_outbox(
  p_event_id uuid,
  p_lease_owner text,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.candidate_projection_outbox
  SET delivered_at = clock_timestamp(),
      lease_owner = NULL,
      lease_token = NULL,
      lease_until = NULL,
      last_error = NULL
  WHERE event_id = p_event_id
    AND delivered_at IS NULL
    AND lease_owner = p_lease_owner
    AND lease_token = p_lease_token
    AND lease_until > clock_timestamp();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$$;

ALTER TABLE public.candidate_projection_producer_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_projection_runtime_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_event_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_serving_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_projection_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.candidate_projection_producer_flags,
  public.candidate_projection_runtime_controls,
  public.candidate_event_versions,
  public.candidate_serving_controls,
  public.candidate_deletion_tombstones,
  public.candidate_projection_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_projection_next_version(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_projection_emit_row_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_deletion_tombstone_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.candidate_serving_control_fail_closed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_candidate_deletion(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_candidate_projection_outbox(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ack_candidate_projection_outbox(uuid, text, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.candidate_projection_producer_flags,
      public.candidate_projection_runtime_controls,
      public.candidate_event_versions,
      public.candidate_serving_controls,
      public.candidate_deletion_tombstones,
      public.candidate_projection_outbox FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.candidate_projection_producer_flags,
      public.candidate_projection_runtime_controls,
      public.candidate_event_versions,
      public.candidate_serving_controls,
      public.candidate_deletion_tombstones,
      public.candidate_projection_outbox FROM authenticated;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.claim_candidate_projection_outbox(text, integer, integer)
  TO hirly_candidate_projection_relay;
GRANT EXECUTE ON FUNCTION public.ack_candidate_projection_outbox(uuid, text, uuid)
  TO hirly_candidate_projection_relay;

COMMIT;
