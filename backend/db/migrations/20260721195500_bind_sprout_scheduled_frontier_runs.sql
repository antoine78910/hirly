-- TS_MIGRATION: bind every Sprout run to its source before checkpoint reads.
-- Scheduled runs are created source-less by the generic scheduler; they must
-- acquire their source association under the active provider claim without
-- resetting the persisted incremental checkpoint.
BEGIN;

CREATE OR REPLACE FUNCTION worker_private.bind_sprout_source_run(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_provider_claim_id uuid,
  p_source_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF p_mode NOT IN ('canary', 'backfill', 'incremental') THEN
    RAISE EXCEPTION 'invalid Sprout source run mode' USING ERRCODE = '22023';
  END IF;

  SELECT run.id
    INTO v_run_id
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
    AND (run.career_source_id IS NULL OR run.career_source_id = p_source_id)
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
    AND worker_private.career_source_runnable(
      p_source_id,
      upper(source.country_codes[1]),
      p_mode
    )
  FOR UPDATE OF task, run, claim, registry, source;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sprout source, authorization, or writer claim is not current'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.worker_runs
  SET career_source_id = p_source_id
  WHERE id = v_run_id
    AND career_source_id IS NULL;
END
$$;

REVOKE ALL ON FUNCTION worker_private.bind_sprout_source_run(
  uuid, uuid, bigint, text, uuid, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.bind_sprout_source_run(
  uuid, uuid, bigint, text, uuid, uuid, text
) TO hirly_inventory_worker;

COMMIT;
