-- TS_MIGRATION: keep the live Sprout discovery lane fresh without re-running an unbounded backfill.
BEGIN;

CREATE OR REPLACE FUNCTION worker_private.begin_sprout_incremental_cycle(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_provider_claim_id uuid,
  p_source_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_page_size integer;
BEGIN
  SELECT source.approved_page_size INTO v_page_size
  FROM public.worker_tasks AS task
  JOIN public.worker_runs AS run ON run.id = task.run_id
  JOIN public.provider_work_claims AS claim ON claim.id = p_provider_claim_id
  JOIN public.provider_registry AS registry ON registry.provider = claim.provider
  JOIN public.career_sources AS source
    ON source.id = p_source_id AND source.provider = registry.provider
  WHERE task.id = p_task_id
    AND task.provider = 'sprout'
    AND task.status = 'running'
    AND task.lease_token = p_lease_token
    AND task.claim_generation = p_claim_generation
    AND task.lease_owner = p_lease_owner
    AND task.lease_until > clock_timestamp()
    AND run.provider = 'sprout'
    AND run.career_source_id = p_source_id
    AND claim.provider = 'sprout'
    AND claim.captured_runtime = 'typescript'
    AND claim.task_id = p_task_id
    AND claim.task_lease_token = p_lease_token
    AND claim.task_claim_generation = p_claim_generation
    AND claim.lease_owner = p_lease_owner
    AND claim.finished_at IS NULL
    AND claim.expires_at > clock_timestamp()
    AND registry.enabled
    AND registry.authorization_status = 'authorized'
    AND registry.writer_runtime = 'typescript'
    AND registry.ownership_epoch = claim.ownership_epoch
    AND worker_private.career_source_runnable(p_source_id, 'FR', 'incremental')
  FOR UPDATE OF task, run, claim, registry, source;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sprout incremental cycle source, authorization, or writer claim is not current'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.career_sources
  SET checkpoint = jsonb_build_object(
        'version', 'sprout.offset.v1',
        'offset', 0,
        'pageSize', v_page_size,
        'observedTotal', NULL,
        'watermark', NULL
      ),
      updated_at = clock_timestamp()
  WHERE id = p_source_id;
END
$$;

REVOKE ALL ON FUNCTION worker_private.begin_sprout_incremental_cycle(
  uuid, uuid, bigint, text, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.begin_sprout_incremental_cycle(
  uuid, uuid, bigint, text, uuid, uuid
) TO hirly_inventory_worker;

DO $$
DECLARE
  v_source_id uuid;
BEGIN
  SELECT id INTO v_source_id
  FROM public.career_sources
  WHERE provider = 'sprout'
    AND source_key = 'sprout:france:country-only';

  IF v_source_id IS NOT NULL THEN
    PERFORM worker_private.upsert_schedule(
      'sprout-france-country-only-frontier-hourly',
      'provider.fetch_page',
      'sprout',
      '7 * * * *',
      'UTC',
      jsonb_build_object(
        'sourceId', v_source_id,
        'mode', 'incremental',
        'maxResponseBytes', 2000000,
        'cycleStart', true,
        'pageCount', 0,
        'maxPages', 10
      ),
      clock_timestamp(),
      1
    );
    PERFORM worker_private.set_schedule_enabled(
      'sprout-france-country-only-frontier-hourly',
      true,
      clock_timestamp()
    );
  END IF;
END
$$;

COMMIT;
