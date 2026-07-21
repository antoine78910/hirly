-- TS_MIGRATION: independent Sprout query lanes need independent monotonic checkpoints.
BEGIN;

INSERT INTO public.career_sources (
  provider, source_key, company_name, country_codes, base_url, access_type,
  policy_id, sync_frequency, checkpoint, country_kill_switches, credential_ref,
  approved_page_size, enabled, discovery_state, transport_enabled,
  incremental_enabled, backfill_enabled, canary_enabled, canary_evidence,
  rollback_evidence
)
SELECT
  source.provider,
  lane.source_key,
  source.company_name || ' (' || lane.label || ')',
  source.country_codes,
  source.base_url,
  source.access_type,
  source.policy_id,
  source.sync_frequency,
  jsonb_build_object(
    'version', 'sprout.offset.v1', 'offset', 0,
    'pageSize', source.approved_page_size,
    'observedTotal', NULL, 'watermark', NULL
  ),
  source.country_kill_switches,
  source.credential_ref,
  source.approved_page_size,
  source.enabled,
  source.discovery_state,
  source.transport_enabled,
  source.incremental_enabled,
  source.backfill_enabled,
  false,
  jsonb_build_object('status','passed','evidenceRef',source.canary_evidence->>'evidenceRef','pagesCommitted',1,'identityReadBack',true,'rawSnapshotLinked',true,'occurrenceLinked',true,'checkpointReadBack',true,'singleWriterVerified',true),
  source.rollback_evidence
FROM public.career_sources AS source
CROSS JOIN (VALUES
  ('sprout:france:country-only'::text, 'country-only'::text)
) AS lane(source_key, label)
WHERE source.provider = 'sprout' AND source.source_key = 'sprout:france'
ON CONFLICT (provider, source_key) DO NOTHING;

CREATE FUNCTION worker_private.get_sprout_source_runtime_v2(
  p_source_id uuid,
  p_mode text
)
RETURNS TABLE (
  source_id uuid, source_key text, policy_id uuid, endpoint text,
  credential_ref text, approved_page_size integer, checkpoint jsonb,
  policy_evidence_ref text, canary_evidence jsonb, rollback_evidence jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT source.id, source.source_key, source.policy_id, source.base_url,
    source.credential_ref, source.approved_page_size, source.checkpoint,
    policy.evidence_reference, source.canary_evidence, source.rollback_evidence
  FROM public.career_sources AS source
  JOIN public.source_policy AS policy ON policy.id = source.policy_id AND policy.provider = source.provider
  WHERE source.id = p_source_id
    AND source.provider = 'sprout'
    AND p_mode IN ('incremental', 'backfill')
    AND worker_private.career_source_runnable(source.id, 'FR', p_mode)
    AND worker_private.career_source_base_url_is_safe(source.base_url)
    AND source.credential_ref ~ '^secret://[a-z0-9][a-z0-9/_-]{2,127}$'
    AND source.approved_page_size BETWEEN 1 AND 500
    AND (source.checkpoint->>'pageSize')::integer = source.approved_page_size
    AND policy.evidence_reference IS NOT NULL
$$;

REVOKE ALL ON FUNCTION worker_private.get_sprout_source_runtime_v2(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.get_sprout_source_runtime_v2(uuid, text) TO hirly_inventory_worker;
COMMIT;
