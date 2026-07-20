-- TS_NEW: replay-safe, operator-driven PostHog historical migration ledger.
BEGIN;

CREATE TABLE public.posthog_migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transform_version text NOT NULL CHECK (length(btrim(transform_version)) > 0),
  source_cutoff_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'stopped', 'completed', 'failed')),
  dry_run boolean NOT NULL DEFAULT true,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest jsonb,
  stop_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT posthog_migration_runs_terminal_shape CHECK (
    (status IN ('completed', 'failed')) = (finished_at IS NOT NULL)
  )
);

CREATE TABLE public.posthog_migration_ledger (
  run_id uuid NOT NULL REFERENCES public.posthog_migration_runs(id) ON DELETE RESTRICT,
  source_event_id text NOT NULL CHECK (length(btrim(source_event_id)) > 0),
  source_created_at timestamptz NOT NULL,
  canonical_event_name text,
  transform_version text NOT NULL CHECK (length(btrim(transform_version)) > 0),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  timestamp_quality text NOT NULL CHECK (
    timestamp_quality IN (
      'exact_business_timestamp',
      'validated_client_occurrence',
      'server_received_at',
      'unknown'
    )
  ),
  identity_quality text NOT NULL CHECK (
    identity_quality IN (
      'identified_at_ingest',
      'legacy_anonymous_unlinked',
      'legacy_anonymous_one_to_one',
      'legacy_anonymous_ambiguous',
      'unknown'
    )
  ),
  status text NOT NULL CHECK (
    status IN (
      'pending', 'claimed', 'accepted', 'observed',
      'excluded', 'quarantined', 'uncertain'
    )
  ),
  disposition_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  send_started_at timestamptz,
  accepted_at timestamptz,
  observed_at timestamptz,
  posthog_response jsonb,
  transformed_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id, source_event_id),
  CONSTRAINT posthog_migration_ledger_lease_shape CHECK (
    (status = 'claimed') =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT posthog_migration_ledger_accept_shape CHECK (
    (status IN ('accepted', 'observed')) = (accepted_at IS NOT NULL)
  ),
  CONSTRAINT posthog_migration_ledger_observed_shape CHECK (
    (status = 'observed') = (observed_at IS NOT NULL)
  ),
  CONSTRAINT posthog_migration_ledger_terminal_reason CHECK (
    status NOT IN ('excluded', 'quarantined', 'uncertain')
    OR disposition_reason IS NOT NULL
  )
);

CREATE INDEX posthog_migration_ledger_claim_idx
  ON public.posthog_migration_ledger (run_id, status, source_created_at, source_event_id);

CREATE OR REPLACE FUNCTION public.claim_posthog_migration_rows(
  p_run_id uuid,
  p_lease_owner text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS SETOF public.posthog_migration_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF length(btrim(p_lease_owner)) = 0
    OR p_limit NOT BETWEEN 1 AND 1000
    OR p_lease_seconds NOT BETWEEN 30 AND 3600
  THEN
    RAISE EXCEPTION 'invalid PostHog migration claim' USING ERRCODE = '22023';
  END IF;

  -- Once transport may have started, lease expiry is uncertainty, never permission
  -- to replay. Only pre-send expired claims can return to the claimable set.
  UPDATE public.posthog_migration_ledger
  SET status = 'uncertain',
      disposition_reason = 'claim_expired_after_send_started',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
  WHERE run_id = p_run_id
    AND status = 'claimed'
    AND lease_expires_at <= v_now
    AND send_started_at IS NOT NULL;

  -- Any unresolved outcome freezes the run. An operator must reconcile it
  -- read-side before another source row can be sent.
  IF EXISTS (
    SELECT 1
    FROM public.posthog_migration_ledger
    WHERE run_id = p_run_id AND status = 'uncertain'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT ledger.run_id, ledger.source_event_id
    FROM public.posthog_migration_ledger AS ledger
    WHERE ledger.run_id = p_run_id
      AND (
        ledger.status = 'pending'
        OR (
          ledger.status = 'claimed'
          AND ledger.lease_expires_at <= v_now
          AND ledger.send_started_at IS NULL
        )
      )
    ORDER BY ledger.source_created_at, ledger.source_event_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.posthog_migration_ledger AS ledger
  SET status = 'claimed',
      attempt_count = ledger.attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_token = gen_random_uuid(),
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      disposition_reason = NULL,
      updated_at = v_now
  FROM candidates
  WHERE ledger.run_id = candidates.run_id
    AND ledger.source_event_id = candidates.source_event_id
  RETURNING ledger.*;
END
$$;

CREATE OR REPLACE FUNCTION public.mark_posthog_migration_send_started(
  p_run_id uuid,
  p_source_event_id text,
  p_lease_owner text,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH changed AS (
    UPDATE public.posthog_migration_ledger
    SET send_started_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE run_id = p_run_id
      AND source_event_id = p_source_event_id
      AND status = 'claimed'
      AND lease_owner = p_lease_owner
      AND lease_token = p_lease_token
      AND lease_expires_at > clock_timestamp()
      AND send_started_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed)
$$;

CREATE OR REPLACE FUNCTION public.accept_posthog_migration_row(
  p_run_id uuid,
  p_source_event_id text,
  p_lease_owner text,
  p_lease_token uuid,
  p_response jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH changed AS (
    UPDATE public.posthog_migration_ledger
    SET status = 'accepted',
        accepted_at = clock_timestamp(),
        posthog_response = p_response,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE run_id = p_run_id
      AND source_event_id = p_source_event_id
      AND status = 'claimed'
      AND lease_owner = p_lease_owner
      AND lease_token = p_lease_token
      AND send_started_at IS NOT NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed)
$$;

CREATE OR REPLACE FUNCTION public.observe_posthog_migration_row(
  p_run_id uuid,
  p_source_event_id text,
  p_observation jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH changed AS (
    UPDATE public.posthog_migration_ledger
    SET status = 'observed',
        observed_at = clock_timestamp(),
        posthog_response = coalesce(posthog_response, '{}'::jsonb) || p_observation,
        updated_at = clock_timestamp()
    WHERE run_id = p_run_id
      AND source_event_id = p_source_event_id
      AND status = 'accepted'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed)
$$;

REVOKE ALL ON public.posthog_migration_runs FROM PUBLIC;
REVOKE ALL ON public.posthog_migration_ledger FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_posthog_migration_rows(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_posthog_migration_send_started(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_posthog_migration_row(uuid, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.observe_posthog_migration_row(uuid, text, jsonb) FROM PUBLIC;

COMMIT;
