-- TS_NEW: disabled, idempotent ATS tenant candidate registration.
-- This function only records discovery metadata. It cannot enable a source,
-- approve policy, or change provider_registry writer ownership.
BEGIN;

CREATE OR REPLACE FUNCTION worker_private.register_career_source_candidate(
  p_provider text,
  p_source_key text,
  p_tenant_key text,
  p_company_id text,
  p_company_name text,
  p_country_codes text[],
  p_base_url text,
  p_access_type text,
  p_policy_id uuid,
  p_sync_frequency_seconds integer,
  p_checkpoint jsonb
)
RETURNS public.career_sources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_by_key public.career_sources;
  v_by_tenant public.career_sources;
  v_source public.career_sources;
BEGIN
  IF p_provider IS NULL OR length(btrim(p_provider)) = 0
    OR p_source_key IS NULL OR length(btrim(p_source_key)) = 0
    OR p_tenant_key IS NULL OR length(btrim(p_tenant_key)) = 0
    OR p_country_codes IS NULL OR cardinality(p_country_codes) = 0
    OR NOT worker_private.country_code_array_is_valid(p_country_codes)
    OR p_base_url IS NULL
    OR p_base_url !~ '^https://[^/?#[:space:]@]+(?::[0-9]+)?(?:/[^?#[:space:]]*)?/?$'
    OR p_access_type NOT IN ('public_api', 'open_data', 'tenant_feed', 'partner_feed')
    OR p_checkpoint IS NULL
    OR jsonb_typeof(p_checkpoint) <> 'object'
    OR (
      p_sync_frequency_seconds IS NOT NULL
      AND p_sync_frequency_seconds <= 0
    )
  THEN
    RAISE EXCEPTION 'invalid career source candidate'
      USING ERRCODE = '22023';
  END IF;

  -- Candidate registration is low-volume. A provider-scoped transaction lock
  -- makes concurrent source-key/tenant-key rediscovery deterministic across
  -- both unique identities instead of relying on one conflict target.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider, 0));

  SELECT source.*
  INTO v_by_key
  FROM public.career_sources AS source
  WHERE source.provider = p_provider
    AND source.source_key = btrim(p_source_key)
  FOR UPDATE;

  SELECT source.*
  INTO v_by_tenant
  FROM public.career_sources AS source
  WHERE source.provider = p_provider
    AND source.tenant_key = btrim(p_tenant_key)
  FOR UPDATE;

  IF v_by_key.id IS NOT NULL
    AND v_by_tenant.id IS NOT NULL
    AND v_by_key.id <> v_by_tenant.id
  THEN
    RAISE EXCEPTION
      'career source key and tenant identify different rows'
      USING ERRCODE = '23505';
  END IF;

  v_source := coalesce(v_by_key, v_by_tenant);

  IF v_source.id IS NULL THEN
    INSERT INTO public.career_sources (
      provider,
      source_key,
      tenant_key,
      company_id,
      company_name,
      country_codes,
      base_url,
      access_type,
      policy_id,
      sync_frequency,
      checkpoint,
      enabled,
      discovery_state,
      transport_enabled,
      incremental_enabled,
      backfill_enabled
    )
    VALUES (
      p_provider,
      btrim(p_source_key),
      btrim(p_tenant_key),
      nullif(btrim(p_company_id), ''),
      nullif(btrim(p_company_name), ''),
      ARRAY(
        SELECT DISTINCT upper(country_code)
        FROM unnest(p_country_codes) AS country_code
        ORDER BY upper(country_code)
      ),
      p_base_url,
      p_access_type,
      p_policy_id,
      make_interval(secs => p_sync_frequency_seconds),
      p_checkpoint,
      false,
      'candidate',
      false,
      false,
      false
    )
    RETURNING * INTO v_source;
    RETURN v_source;
  END IF;

  -- Discovery is not an activation or operator-policy surface. Once a source
  -- is approved or runnable, rediscovery returns it without mutating metadata,
  -- policy, checkpoint, health, or any enablement flag.
  IF v_source.discovery_state = 'approved'
    OR v_source.enabled
    OR v_source.transport_enabled
    OR v_source.incremental_enabled
    OR v_source.backfill_enabled
  THEN
    RETURN v_source;
  END IF;

  UPDATE public.career_sources
  SET
    tenant_key = btrim(p_tenant_key),
    company_id = coalesce(nullif(btrim(p_company_id), ''), company_id),
    company_name = coalesce(nullif(btrim(p_company_name), ''), company_name),
    country_codes = ARRAY(
      SELECT DISTINCT upper(country_code)
      FROM unnest(p_country_codes) AS country_code
      ORDER BY upper(country_code)
    ),
    base_url = p_base_url,
    access_type = p_access_type,
    policy_id = coalesce(policy_id, p_policy_id),
    sync_frequency = coalesce(
      make_interval(secs => p_sync_frequency_seconds),
      sync_frequency
    ),
    updated_at = clock_timestamp()
  WHERE id = v_source.id
  RETURNING * INTO v_source;

  RETURN v_source;
END
$$;

REVOKE ALL ON FUNCTION worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, uuid, integer, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, uuid, integer, jsonb
) TO hirly_inventory_worker, hirly_inventory_operator;

COMMIT;
