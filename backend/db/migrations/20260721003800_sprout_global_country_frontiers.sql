-- TS_MIGRATION: minimally-filtered, country-scoped Sprout frontiers with independent checkpoints.
BEGIN;

CREATE OR REPLACE FUNCTION worker_private.commit_sprout_source_page(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_provider_claim_id uuid,
  p_source_id uuid,
  p_country_code text,
  p_mode text,
  p_checkpoint_in jsonb,
  p_checkpoint_out jsonb,
  p_complete boolean,
  p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_run_id uuid;
  v_entry jsonb;
  v_job jsonb;
  v_expected_job_id text;
  v_snapshot_id uuid;
  v_existing_job_id text;
  v_match_job_id text;
  v_match_group_id uuid;
  v_group_id uuid;
  v_evidence_layer text;
  v_collision_reason text;
  v_snapshots integer := 0;
  v_jobs integer := 0;
  v_occurrences integer := 0;
  v_groups integer := 0;
  v_affected integer := 0;
  v_source_commit_at timestamptz;
BEGIN
  IF upper(p_country_code) !~ '^[A-Z]{2}$'
    OR p_mode NOT IN ('incremental', 'backfill')
    OR jsonb_typeof(p_checkpoint_in) <> 'object'
    OR jsonb_typeof(p_checkpoint_out) <> 'object'
    OR jsonb_typeof(p_entries) <> 'array'
    OR jsonb_array_length(p_entries) NOT BETWEEN 0 AND 500
  THEN
    RAISE EXCEPTION 'invalid Sprout source page commit' USING ERRCODE = '22023';
  END IF;

  SELECT task.run_id INTO v_run_id
  FROM public.worker_tasks AS task
  JOIN public.worker_runs AS run ON run.id = task.run_id
  JOIN public.provider_work_claims AS claim
    ON claim.id = p_provider_claim_id
  JOIN public.provider_registry AS registry
    ON registry.provider = claim.provider
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
    AND source.checkpoint = p_checkpoint_in
    AND worker_private.career_source_runnable(p_source_id, upper(p_country_code), p_mode)
  FOR UPDATE OF task, run, claim, registry, source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sprout source, authorization, checkpoint, or writer claim is not current'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO worker_private.provider_write_transactions (
    transaction_id, claim_id, provider
  ) VALUES (txid_current(), p_provider_claim_id, 'sprout');

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_job := v_entry->'canonical';
    IF jsonb_typeof(v_entry->'source_document') <> 'object'
      OR v_job->>'provider' IS DISTINCT FROM 'sprout'
      OR v_job->>'country_code' IS DISTINCT FROM upper(p_country_code)
      OR coalesce(v_job->>'external_id', '') = ''
      OR coalesce(v_entry->>'content_hash', '') !~ '^[0-9a-f]{64}$'
      OR (v_entry->>'policy_id')::uuid IS DISTINCT FROM (
        SELECT policy_id FROM public.career_sources WHERE id = p_source_id
      )
    THEN
      RAISE EXCEPTION 'invalid Sprout entry identity or source evidence'
        USING ERRCODE = '22023';
    END IF;

    v_expected_job_id := 'job_' || substr(
      encode(public.digest('sprout:' || (v_job->>'external_id'), 'sha1'), 'hex'),
      1, 16
    );
    IF v_job->>'job_id' IS DISTINCT FROM v_expected_job_id THEN
      RAISE EXCEPTION 'deterministic Sprout job id mismatch' USING ERRCODE = '23000';
    END IF;

    SELECT job_id INTO v_existing_job_id
    FROM public.jobs
    WHERE provider = 'sprout' AND external_id = v_job->>'external_id'
    FOR UPDATE;
    IF FOUND AND v_existing_job_id <> v_expected_job_id THEN
      RAISE EXCEPTION 'existing Sprout identity maps to another job id'
        USING ERRCODE = '23000';
    END IF;

    INSERT INTO public.jobs (
      job_id, provider, external_id, title, normalized_title, company,
      normalized_company, location, city, region, country_code, remote,
      salary_min, salary_max, currency, posted_at, imported_at, last_seen_at,
      selected_apply_url, canonical_apply_url, validation_status,
      validation_reason, validation_checked_at, applyability_tier,
      applyability_score, apply_fulfillment_status, apply_url_provider,
      ats_provider, ats_job_id, requires_login, requires_account_creation,
      captcha_detected, manual_fulfillment_ready, auto_apply_supported,
      rejection_reason, fingerprint, data, source_id, first_seen_at,
      lifecycle_state, lifecycle_checked_at
    ) VALUES (
      v_expected_job_id, 'sprout', v_job->>'external_id', v_job->>'title',
      v_job->>'normalized_title', v_job->>'company',
      v_job->>'normalized_company', v_job->>'location', v_job->>'city',
      v_job->>'region', upper(p_country_code), (v_job->>'remote')::boolean,
      (v_job->>'salary_min')::numeric, (v_job->>'salary_max')::numeric,
      v_job->>'currency', (v_job->>'posted_at')::timestamptz,
      coalesce((v_job->>'imported_at')::timestamptz, clock_timestamp()),
      coalesce((v_job->>'last_seen_at')::timestamptz, clock_timestamp()),
      v_job->>'selected_apply_url', v_entry->>'canonical_apply_url',
      v_job->>'validation_status', v_job->>'validation_reason',
      (v_job->>'validation_checked_at')::timestamptz,
      v_job->>'applyability_tier', (v_job->>'applyability_score')::numeric,
      v_job->>'apply_fulfillment_status', v_job->>'apply_url_provider',
      v_job->>'ats_provider', v_entry->>'ats_posting_id',
      coalesce((v_job->>'requires_login')::boolean, false),
      coalesce((v_job->>'requires_account_creation')::boolean, false),
      coalesce((v_job->>'captcha_detected')::boolean, false),
      coalesce((v_job->>'manual_fulfillment_ready')::boolean, false),
      coalesce((v_job->>'auto_apply_supported')::boolean, false),
      v_job->>'rejection_reason', v_job->>'fingerprint',
      coalesce(v_job->'data', '{}'::jsonb), p_source_id,
      coalesce((v_job->>'imported_at')::timestamptz, clock_timestamp()),
      v_entry->>'lifecycle_state', clock_timestamp()
    )
    ON CONFLICT (job_id) DO UPDATE SET
      title = EXCLUDED.title,
      normalized_title = EXCLUDED.normalized_title,
      company = EXCLUDED.company,
      normalized_company = EXCLUDED.normalized_company,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      region = EXCLUDED.region,
      country_code = EXCLUDED.country_code,
      remote = EXCLUDED.remote,
      salary_min = EXCLUDED.salary_min,
      salary_max = EXCLUDED.salary_max,
      currency = EXCLUDED.currency,
      posted_at = EXCLUDED.posted_at,
      last_seen_at = EXCLUDED.last_seen_at,
      selected_apply_url = EXCLUDED.selected_apply_url,
      canonical_apply_url = EXCLUDED.canonical_apply_url,
      validation_status = EXCLUDED.validation_status,
      validation_reason = EXCLUDED.validation_reason,
      validation_checked_at = EXCLUDED.validation_checked_at,
      applyability_tier = EXCLUDED.applyability_tier,
      applyability_score = EXCLUDED.applyability_score,
      apply_fulfillment_status = EXCLUDED.apply_fulfillment_status,
      apply_url_provider = EXCLUDED.apply_url_provider,
      ats_provider = EXCLUDED.ats_provider,
      ats_job_id = EXCLUDED.ats_job_id,
      requires_login = EXCLUDED.requires_login,
      requires_account_creation = EXCLUDED.requires_account_creation,
      captcha_detected = EXCLUDED.captcha_detected,
      manual_fulfillment_ready = EXCLUDED.manual_fulfillment_ready,
      auto_apply_supported = EXCLUDED.auto_apply_supported,
      rejection_reason = EXCLUDED.rejection_reason,
      fingerprint = EXCLUDED.fingerprint,
      data = EXCLUDED.data,
      lifecycle_state = EXCLUDED.lifecycle_state,
      lifecycle_checked_at = EXCLUDED.lifecycle_checked_at;
    v_jobs := v_jobs + 1;

    INSERT INTO public.raw_job_snapshots (
      source_id, provider, external_id, content_hash, fetched_at, payload, run_id
    ) VALUES (
      p_source_id, 'sprout', v_job->>'external_id', v_entry->>'content_hash',
      (v_entry->>'fetched_at')::timestamptz, v_entry->'source_document', v_run_id
    )
    ON CONFLICT (run_id, source_id, external_id, content_hash) DO NOTHING
    RETURNING id INTO v_snapshot_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_snapshots := v_snapshots + v_affected;
    IF v_snapshot_id IS NULL THEN
      SELECT id INTO v_snapshot_id
      FROM public.raw_job_snapshots
      WHERE run_id = v_run_id
        AND source_id = p_source_id
        AND external_id = v_job->>'external_id'
        AND content_hash = v_entry->>'content_hash';
    END IF;

    INSERT INTO public.job_occurrences (
      job_id, source_id, provider, tenant_key, external_id,
      canonical_source_url, canonical_apply_url, ats_posting_id,
      first_seen_at, last_seen_at, published_at, expires_at, lifecycle_state,
      content_hash, raw_snapshot_id, attribution, policy_id
    ) VALUES (
      v_expected_job_id, p_source_id, 'sprout', NULL,
      v_job->>'external_id', v_entry->>'canonical_source_url',
      v_entry->>'canonical_apply_url', v_entry->>'ats_posting_id',
      (v_entry->>'fetched_at')::timestamptz,
      (v_entry->>'fetched_at')::timestamptz,
      (v_entry->>'published_at')::timestamptz,
      (v_entry->>'expires_at')::timestamptz,
      v_entry->>'lifecycle_state', v_entry->>'content_hash', v_snapshot_id,
      coalesce(v_entry->'attribution', '{}'::jsonb),
      (v_entry->>'policy_id')::uuid
    )
    ON CONFLICT (job_id) DO UPDATE SET
      -- Keep source_id, raw_snapshot_id, content_hash, attribution, and policy_id
      -- immutable here: they are bound by the occurrence-to-snapshot FK and
      -- identify the canonical job's first authoritative source occurrence.
      -- The overlapping lane still retains its full provider document in
      -- raw_job_snapshots and advances its own checkpoint.
      last_seen_at = GREATEST(
        public.job_occurrences.last_seen_at,
        EXCLUDED.last_seen_at
      ),
      published_at = EXCLUDED.published_at,
      expires_at = EXCLUDED.expires_at,
      lifecycle_state = EXCLUDED.lifecycle_state,
      canonical_source_url = EXCLUDED.canonical_source_url,
      canonical_apply_url = EXCLUDED.canonical_apply_url,
      ats_posting_id = EXCLUDED.ats_posting_id,
      updated_at = clock_timestamp();
    v_occurrences := v_occurrences + 1;

    SELECT canonical_group_id INTO v_group_id
    FROM public.jobs
    WHERE job_id = v_expected_job_id
    FOR UPDATE;
    v_match_job_id := NULL;
    v_match_group_id := NULL;
    v_collision_reason := NULL;
    v_evidence_layer := NULL;
    IF v_group_id IS NULL THEN
      SELECT occurrence.job_id, job.canonical_group_id,
        CASE
          WHEN v_entry->>'ats_posting_id' IS NOT NULL
            AND occurrence.ats_posting_id = v_entry->>'ats_posting_id'
            AND v_entry->>'canonical_apply_url' IS NOT NULL
            AND occurrence.canonical_apply_url IS NOT NULL
            AND occurrence.canonical_apply_url <> v_entry->>'canonical_apply_url'
            THEN 'ats_id_conflicts_with_apply_url'
          WHEN v_entry->>'canonical_apply_url' IS NOT NULL
            AND occurrence.canonical_apply_url = v_entry->>'canonical_apply_url'
            AND v_entry->>'ats_posting_id' IS NOT NULL
            AND occurrence.ats_posting_id IS NOT NULL
            AND occurrence.ats_posting_id <> v_entry->>'ats_posting_id'
            THEN 'apply_url_conflicts_with_ats_id'
          ELSE NULL
        END,
        CASE
          WHEN occurrence.ats_posting_id = v_entry->>'ats_posting_id'
            THEN 'ats_posting_id'
          WHEN occurrence.canonical_apply_url = v_entry->>'canonical_apply_url'
            THEN 'canonical_apply_url'
          ELSE NULL
        END
      INTO v_match_job_id, v_match_group_id, v_collision_reason, v_evidence_layer
      FROM public.job_occurrences AS occurrence
      JOIN public.jobs AS job ON job.job_id = occurrence.job_id
      WHERE occurrence.job_id <> v_expected_job_id
        AND (
          (v_entry->>'ats_posting_id' IS NOT NULL
            AND occurrence.ats_posting_id = v_entry->>'ats_posting_id')
          OR
          (v_entry->>'canonical_apply_url' IS NOT NULL
            AND occurrence.canonical_apply_url = v_entry->>'canonical_apply_url')
        )
      ORDER BY
        (CASE
          WHEN v_entry->>'ats_posting_id' IS NOT NULL
            AND occurrence.ats_posting_id = v_entry->>'ats_posting_id'
            AND v_entry->>'canonical_apply_url' IS NOT NULL
            AND occurrence.canonical_apply_url IS NOT NULL
            AND occurrence.canonical_apply_url <> v_entry->>'canonical_apply_url'
            THEN false
          WHEN v_entry->>'canonical_apply_url' IS NOT NULL
            AND occurrence.canonical_apply_url = v_entry->>'canonical_apply_url'
            AND v_entry->>'ats_posting_id' IS NOT NULL
            AND occurrence.ats_posting_id IS NOT NULL
            AND occurrence.ats_posting_id <> v_entry->>'ats_posting_id'
            THEN false
          ELSE true
        END) DESC,
        (occurrence.ats_posting_id = v_entry->>'ats_posting_id') DESC,
        (job.canonical_group_id IS NOT NULL) DESC,
        occurrence.first_seen_at,
        occurrence.job_id
      LIMIT 1
      FOR UPDATE OF occurrence, job;

      IF v_match_job_id IS NOT NULL AND v_collision_reason IS NOT NULL THEN
        INSERT INTO public.source_identity_collisions (
          source_id, incoming_job_id, existing_job_id, reason, evidence
        ) VALUES (
          p_source_id, v_expected_job_id, v_match_job_id, v_collision_reason,
          jsonb_build_object(
            'atsPostingId', v_entry->>'ats_posting_id',
            'canonicalApplyUrl', v_entry->>'canonical_apply_url'
          )
        ) ON CONFLICT DO NOTHING;
        v_match_job_id := NULL;
        v_match_group_id := NULL;
        v_evidence_layer := NULL;
      END IF;

      IF v_match_job_id IS NULL THEN
        INSERT INTO "public".canonical_job_groups (
          preferred_job_id, merge_confidence, merge_reason
        ) VALUES (
          v_expected_job_id, 1, 'source_identity'
        ) RETURNING id INTO v_group_id;
        v_groups := v_groups + 1;
        v_evidence_layer := 'source_identity';
      ELSIF v_match_group_id IS NULL THEN
        INSERT INTO "public".canonical_job_groups (
          preferred_job_id, merge_confidence, merge_reason
        ) VALUES (
          v_match_job_id,
          CASE v_evidence_layer WHEN 'ats_posting_id' THEN 0.99 ELSE 0.95 END,
          v_evidence_layer
        ) RETURNING id INTO v_group_id;
        v_groups := v_groups + 1;
        UPDATE public.jobs SET canonical_group_id = v_group_id
        WHERE job_id = v_match_job_id AND canonical_group_id IS NULL;
        INSERT INTO "public".canonical_job_group_members (
          group_id, job_id, evidence_layer, confidence
        ) VALUES (
          v_group_id, v_match_job_id, 'source_identity', 1
        ) ON CONFLICT (job_id) DO NOTHING;
      ELSE
        v_group_id := v_match_group_id;
      END IF;
    END IF;

    UPDATE public.jobs SET canonical_group_id = v_group_id
    WHERE job_id = v_expected_job_id;
    INSERT INTO "public".canonical_job_group_members (
      group_id, job_id, evidence_layer, confidence
    ) VALUES (
      v_group_id, v_expected_job_id, coalesce(v_evidence_layer, 'source_identity'),
      CASE coalesce(v_evidence_layer, 'source_identity')
        WHEN 'ats_posting_id' THEN 0.99
        WHEN 'canonical_apply_url' THEN 0.95
        ELSE 1
      END
    ) ON CONFLICT (job_id) DO NOTHING;
  END LOOP;

  v_source_commit_at := clock_timestamp();

  UPDATE public.career_sources
  SET checkpoint = p_checkpoint_out,
      last_attempt_at = v_source_commit_at,
      last_success_at = v_source_commit_at,
      last_complete_run_id = CASE WHEN p_complete THEN v_run_id ELSE last_complete_run_id END,
      consecutive_failures = 0,
      updated_at = v_source_commit_at
  WHERE id = p_source_id AND checkpoint = p_checkpoint_in;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sprout checkpoint changed during commit' USING ERRCODE = '40001';
  END IF;

  IF NOT worker_private.finish_task(
    p_task_id, p_lease_token, p_claim_generation, p_lease_owner,
    'succeeded', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Sprout task lease was lost during commit' USING ERRCODE = '42501';
  END IF;
  UPDATE public.provider_work_claims
  SET finished_at = clock_timestamp()
  WHERE id = p_provider_claim_id AND finished_at IS NULL;
  DELETE FROM worker_private.provider_write_transactions
  WHERE transaction_id = txid_current();

  RETURN jsonb_build_object(
    'snapshotsInserted', v_snapshots,
    'canonicalUpserts', v_jobs,
    'occurrencesUpserted', v_occurrences,
    'groupsCreated', v_groups,
    'checkpoint', p_checkpoint_out
  );
END
$$;



CREATE OR REPLACE FUNCTION worker_private.get_sprout_source_runtime_v3(
  p_source_id uuid,
  p_mode text
)
RETURNS TABLE (
  source_id uuid, source_key text, country_code text, policy_id uuid, endpoint text,
  credential_ref text, approved_page_size integer, checkpoint jsonb,
  policy_evidence_ref text, canary_evidence jsonb, rollback_evidence jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT source.id, source.source_key, source.country_codes[1], source.policy_id, source.base_url,
    source.credential_ref, source.approved_page_size, source.checkpoint,
    policy.evidence_reference, source.canary_evidence, source.rollback_evidence
  FROM public.career_sources AS source
  JOIN public.source_policy AS policy ON policy.id = source.policy_id AND policy.provider = source.provider
  WHERE source.id = p_source_id
    AND source.provider = 'sprout'
    AND cardinality(source.country_codes) = 1
    AND p_mode IN ('incremental', 'backfill')
    AND worker_private.career_source_runnable(source.id, source.country_codes[1], p_mode)
    AND worker_private.career_source_base_url_is_safe(source.base_url)
    AND source.credential_ref ~ '^secret://[a-z0-9][a-z0-9/_-]{2,127}$'
    AND source.approved_page_size BETWEEN 1 AND 500
    AND (source.checkpoint->>'pageSize')::integer = source.approved_page_size
    AND policy.evidence_reference IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION worker_private.begin_sprout_incremental_cycle(
  p_task_id uuid, p_lease_token uuid, p_claim_generation bigint, p_lease_owner text,
  p_provider_claim_id uuid, p_source_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, worker_private AS $$
DECLARE v_page_size integer; v_run_id uuid; v_country_code text;
BEGIN
  SELECT source.approved_page_size, run.id, source.country_codes[1]
    INTO v_page_size, v_run_id, v_country_code
  FROM public.worker_tasks task
  JOIN public.worker_runs run ON run.id = task.run_id
  JOIN public.provider_work_claims claim ON claim.id = p_provider_claim_id
  JOIN public.provider_registry registry ON registry.provider = claim.provider
  JOIN public.career_sources source ON source.id = p_source_id AND source.provider = registry.provider
  WHERE task.id=p_task_id AND task.provider='sprout' AND task.status='running'
    AND task.lease_token=p_lease_token AND task.claim_generation=p_claim_generation
    AND task.lease_owner=p_lease_owner AND task.lease_until>clock_timestamp()
    AND run.provider='sprout' AND (run.career_source_id IS NULL OR run.career_source_id=p_source_id)
    AND claim.provider='sprout' AND claim.captured_runtime='typescript' AND claim.task_id=p_task_id
    AND claim.task_lease_token=p_lease_token AND claim.task_claim_generation=p_claim_generation
    AND claim.lease_owner=p_lease_owner AND claim.finished_at IS NULL AND claim.expires_at>clock_timestamp()
    AND registry.enabled AND registry.authorization_status='authorized' AND registry.writer_runtime='typescript'
    AND registry.ownership_epoch=claim.ownership_epoch AND cardinality(source.country_codes)=1
    AND worker_private.career_source_runnable(p_source_id, source.country_codes[1], 'incremental')
  FOR UPDATE OF task, run, claim, registry, source;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sprout incremental cycle source, authorization, or writer claim is not current' USING ERRCODE='42501'; END IF;
  UPDATE public.worker_runs SET career_source_id=p_source_id WHERE id=v_run_id AND career_source_id IS NULL;
  UPDATE public.career_sources SET checkpoint=jsonb_build_object('version','sprout.offset.v1','offset',0,'pageSize',v_page_size,'observedTotal',NULL,'watermark',NULL), updated_at=clock_timestamp() WHERE id=p_source_id;
END $$;

INSERT INTO public.career_sources (provider, source_key, company_name, country_codes, base_url, access_type, policy_id, sync_frequency, checkpoint, country_kill_switches, credential_ref, approved_page_size, enabled, discovery_state, transport_enabled, incremental_enabled, backfill_enabled, canary_enabled, canary_evidence, rollback_evidence)
SELECT source.provider, 'sprout:country:' || lane.code, source.company_name || ' (' || lane.code || ')', ARRAY[lane.code], source.base_url, source.access_type, source.policy_id, source.sync_frequency, jsonb_build_object('version','sprout.offset.v1','offset',0,'pageSize',source.approved_page_size,'observedTotal',NULL,'watermark',NULL), jsonb_build_object(lane.code,false), source.credential_ref, source.approved_page_size, true, 'approved', true, true, false, false, source.canary_evidence, source.rollback_evidence
FROM public.career_sources source
CROSS JOIN (VALUES ('US'),('DE'),('GB'),('CA'),('AU'),('IN')) AS lane(code)
WHERE source.provider='sprout' AND source.source_key='sprout:france:country-only'
  AND source.discovery_state='approved' AND source.canary_evidence->>'status'='passed'
ON CONFLICT (provider, source_key) DO NOTHING;

DO $$
DECLARE source_row record;
BEGIN
  FOR source_row IN SELECT id, source_key FROM public.career_sources WHERE provider='sprout' AND source_key IN ('sprout:france:country-only','sprout:country:US','sprout:country:DE','sprout:country:GB','sprout:country:CA','sprout:country:AU','sprout:country:IN') AND incremental_enabled
  LOOP
    PERFORM worker_private.upsert_schedule('sprout-' || replace(source_row.source_key, ':', '-') || '-frontier', 'provider.fetch_page', 'sprout', CASE WHEN source_row.source_key='sprout:france:country-only' THEN '*/15 * * * *' ELSE '7 * * * *' END, 'UTC', jsonb_build_object('sourceId',source_row.id,'mode','incremental','maxResponseBytes',2000000,'cycleStart',true,'pageCount',0,'maxPages',CASE WHEN source_row.source_key='sprout:france:country-only' THEN 50 ELSE 10 END), clock_timestamp(), 1);
    -- Schedules are enabled only after the matching TypeScript runtime deploy is healthy.
    PERFORM worker_private.set_schedule_enabled('sprout-' || replace(source_row.source_key, ':', '-') || '-frontier', false, clock_timestamp());
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION worker_private.get_sprout_source_runtime_v3(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.get_sprout_source_runtime_v3(uuid,text) TO hirly_inventory_worker;
REVOKE ALL ON FUNCTION worker_private.begin_sprout_incremental_cycle(uuid,uuid,bigint,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.begin_sprout_incremental_cycle(uuid,uuid,bigint,text,uuid,uuid) TO hirly_inventory_worker;
COMMIT;
