-- TS_NEW: disabled TypeScript ingestion source boundary.
-- Additive only: existing jobs keep their stable job_id/read shape, every new
-- source transport/mode remains disabled, and provider_registry.writer_runtime
-- remains the sole canonical-writer authority.
BEGIN;

ALTER TABLE public.career_sources
  ADD COLUMN IF NOT EXISTS transport_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incremental_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backfill_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS country_kill_switches jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT career_sources_country_kill_switches_guard CHECK (
    jsonb_typeof(country_kill_switches) = 'object'
  );

CREATE TABLE IF NOT EXISTS public.raw_job_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.career_sources(id) ON DELETE RESTRICT,
  external_id text NOT NULL CHECK (length(btrim(external_id)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  run_id uuid NOT NULL REFERENCES public.worker_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT raw_job_snapshots_source_external_hash_unique
    UNIQUE (source_id, external_id, content_hash)
);

CREATE INDEX IF NOT EXISTS raw_job_snapshots_source_fetched_idx
  ON public.raw_job_snapshots (source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS raw_job_snapshots_run_idx
  ON public.raw_job_snapshots (run_id);

CREATE OR REPLACE FUNCTION worker_private.reject_immutable_source_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'source evidence is immutable' USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS raw_job_snapshots_immutable ON public.raw_job_snapshots;
CREATE TRIGGER raw_job_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.raw_job_snapshots
FOR EACH ROW EXECUTE FUNCTION worker_private.reject_immutable_source_evidence();

CREATE TABLE IF NOT EXISTS public.canonical_job_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preferred_job_id text REFERENCES public.jobs(job_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'split', 'superseded', 'archived')),
  merge_confidence numeric CHECK (
    merge_confidence IS NULL OR (merge_confidence >= 0 AND merge_confidence <= 1)
  ),
  merge_reason text,
  superseded_by_group_id uuid REFERENCES public.canonical_job_groups(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT canonical_job_groups_no_self_redirect CHECK (
    superseded_by_group_id IS NULL OR superseded_by_group_id <> id
  )
);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.career_sources(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS canonical_group_id uuid
    REFERENCES public.canonical_job_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_classification text,
  ADD COLUMN IF NOT EXISTS route_confidence numeric CHECK (
    route_confidence IS NULL OR (route_confidence >= 0 AND route_confidence <= 1)
  ),
  ADD COLUMN IF NOT EXISTS route_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_canonical_group_feed_idx
  ON public.jobs (canonical_group_id, last_seen_at DESC)
  WHERE canonical_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_source_active_idx
  ON public.jobs (source_id, last_seen_at DESC)
  WHERE source_id IS NOT NULL AND removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL UNIQUE REFERENCES public.jobs(job_id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  provider text NOT NULL,
  tenant_key text,
  external_id text NOT NULL CHECK (length(btrim(external_id)) > 0),
  canonical_source_url text,
  canonical_apply_url text,
  ats_posting_id text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  published_at timestamptz,
  expires_at timestamptz,
  removed_at timestamptz,
  lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'stale', 'removed', 'expired', 'blocked')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  raw_snapshot_id uuid NOT NULL REFERENCES public.raw_job_snapshots(id) ON DELETE RESTRICT,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attribution) = 'object'),
  policy_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT job_occurrences_source_external_unique UNIQUE (source_id, external_id),
  CONSTRAINT job_occurrences_source_provider_fk
    FOREIGN KEY (source_id, provider)
    REFERENCES public.career_sources(id, provider)
    ON DELETE RESTRICT,
  CONSTRAINT job_occurrences_policy_provider_fk
    FOREIGN KEY (policy_id, provider)
    REFERENCES public.source_policy(id, provider)
    ON DELETE RESTRICT,
  CONSTRAINT job_occurrences_seen_order_guard CHECK (first_seen_at <= last_seen_at)
);

CREATE INDEX IF NOT EXISTS job_occurrences_apply_url_idx
  ON public.job_occurrences (md5(canonical_apply_url))
  WHERE canonical_apply_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_occurrences_ats_posting_idx
  ON public.job_occurrences (ats_posting_id)
  WHERE ats_posting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_occurrences_active_seen_idx
  ON public.job_occurrences (source_id, last_seen_at DESC)
  WHERE lifecycle_state = 'active';

CREATE TABLE IF NOT EXISTS public.canonical_job_group_members (
  group_id uuid NOT NULL REFERENCES public.canonical_job_groups(id) ON DELETE RESTRICT,
  job_id text PRIMARY KEY REFERENCES public.jobs(job_id) ON DELETE RESTRICT,
  evidence_layer text NOT NULL CHECK (
    evidence_layer IN ('source_identity', 'ats_posting_id', 'canonical_apply_url', 'fingerprint', 'manual')
  ),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (group_id, job_id)
);

CREATE INDEX IF NOT EXISTS canonical_job_group_members_group_idx
  ON public.canonical_job_group_members (group_id, joined_at, job_id);

CREATE TABLE IF NOT EXISTS public.canonical_job_group_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.canonical_job_groups(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN ('created', 'merged', 'split', 'preferred_job_changed', 'manual_override')
  ),
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DROP TRIGGER IF EXISTS canonical_job_group_events_immutable
  ON public.canonical_job_group_events;
CREATE TRIGGER canonical_job_group_events_immutable
BEFORE UPDATE OR DELETE ON public.canonical_job_group_events
FOR EACH ROW EXECUTE FUNCTION worker_private.reject_immutable_source_evidence();

CREATE OR REPLACE VIEW public.career_source_runtime_status
WITH (security_invoker = true)
AS
SELECT
  source.id,
  source.provider,
  source.source_key,
  source.tenant_key,
  source.country_codes,
  source.enabled,
  source.transport_enabled,
  source.incremental_enabled,
  source.backfill_enabled,
  source.country_kill_switches,
  registry.country_kill_switches AS provider_country_kill_switches,
  registry.writer_runtime,
  policy.approval_status,
  (
    source.enabled
    AND source.transport_enabled
    AND registry.enabled
    AND registry.writer_runtime = 'typescript'
    AND policy.enabled
    AND policy.approval_status = 'approved'
    AND policy.commercial_use_allowed
    AND policy.redisplay_allowed
    AND policy.expires_at > clock_timestamp()
  ) AS runnable
FROM public.career_sources AS source
JOIN public.provider_registry AS registry ON registry.provider = source.provider
LEFT JOIN public.source_policy AS policy
  ON policy.id = source.policy_id
 AND policy.provider = source.provider;

REVOKE ALL ON public.raw_job_snapshots, public.job_occurrences,
  public.canonical_job_groups, public.canonical_job_group_members,
  public.canonical_job_group_events FROM PUBLIC;
REVOKE ALL ON public.career_source_runtime_status FROM PUBLIC;

GRANT SELECT ON public.raw_job_snapshots, public.job_occurrences,
  public.canonical_job_groups, public.canonical_job_group_members,
  public.canonical_job_group_events, public.career_source_runtime_status
  TO hirly_inventory_reader;
GRANT SELECT ON public.career_source_runtime_status TO hirly_inventory_worker;

COMMIT;
