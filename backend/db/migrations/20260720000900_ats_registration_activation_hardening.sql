-- TS_NEW: separate discovery from operator policy attachment and activation.
-- The discovery worker can only register disabled, policy-free candidates.
BEGIN;

DROP FUNCTION IF EXISTS worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, uuid, integer, jsonb
);

CREATE OR REPLACE FUNCTION worker_private.career_source_base_url_is_safe(
  p_base_url text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_authority text;
  v_hostname text;
BEGIN
  IF p_base_url IS NULL
    OR p_base_url !~ '^https://[^/?#[:space:]@]+(?:/[^?#[:space:]]*)?/?$'
  THEN
    RETURN false;
  END IF;

  v_authority := lower(substring(p_base_url FROM '^https://([^/]+)'));
  IF v_authority IS NULL OR v_authority ~ ':' AND v_authority !~ ':443$' THEN
    RETURN false;
  END IF;
  v_hostname := regexp_replace(v_authority, ':443$', '');

  RETURN v_hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$'
    AND v_hostname LIKE '%.%'
    AND v_hostname !~ '^[0-9.]+$'
    AND v_hostname <> 'localhost'
    AND v_hostname !~ '\.(?:localhost|local|internal|home\.arpa)$';
END
$$;

CREATE OR REPLACE FUNCTION worker_private.register_career_source_candidate(
  p_provider text,
  p_source_key text,
  p_tenant_key text,
  p_company_id text,
  p_company_name text,
  p_country_codes text[],
  p_base_url text,
  p_access_type text,
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
    OR NOT worker_private.career_source_base_url_is_safe(p_base_url)
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
      provider, source_key, tenant_key, company_id, company_name,
      country_codes, base_url, access_type, policy_id, sync_frequency,
      checkpoint, enabled, discovery_state, transport_enabled,
      incremental_enabled, backfill_enabled
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
      NULL,
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
    sync_frequency = coalesce(
      make_interval(secs => p_sync_frequency_seconds),
      sync_frequency
    ),
    discovery_state = 'candidate',
    updated_at = clock_timestamp()
  WHERE id = v_source.id
  RETURNING * INTO v_source;

  RETURN v_source;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.approve_career_source_candidate(
  p_source_id uuid,
  p_expected_base_url text,
  p_policy_id uuid
)
RETURNS public.career_sources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
DECLARE
  v_source public.career_sources;
BEGIN
  SELECT source.*
  INTO v_source
  FROM public.career_sources AS source
  WHERE source.id = p_source_id
  FOR UPDATE;

  IF v_source.id IS NULL
    OR v_source.enabled
    OR v_source.base_url IS DISTINCT FROM p_expected_base_url
    OR NOT worker_private.career_source_base_url_is_safe(v_source.base_url)
    OR NOT EXISTS (
      SELECT 1
      FROM public.source_policy AS policy
      WHERE policy.id = p_policy_id
        AND policy.provider = v_source.provider
    )
  THEN
    RAISE EXCEPTION 'career source candidate approval rejected'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.career_sources
  SET policy_id = p_policy_id,
      discovery_state = 'approved',
      updated_at = clock_timestamp()
  WHERE id = v_source.id
  RETURNING * INTO v_source;

  RETURN v_source;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.enforce_career_source_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, worker_private
AS $$
BEGIN
  IF NEW.discovery_state = 'approved'
    AND NOT worker_private.career_source_base_url_is_safe(NEW.base_url)
  THEN
    RAISE EXCEPTION 'approved career source requires a safe canonical base URL'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.enabled AND (
    NEW.discovery_state <> 'approved'
    OR NOT worker_private.career_source_base_url_is_safe(NEW.base_url)
    OR NOT EXISTS (
      SELECT 1
      FROM public.provider_registry AS registry
      JOIN public.source_policy AS policy
        ON policy.id = NEW.policy_id
       AND policy.provider = registry.provider
      WHERE registry.provider = NEW.provider
        AND registry.enabled
        AND registry.authorization_status = 'authorized'
        AND registry.writer_runtime IN ('python', 'typescript')
        AND policy.enabled
        AND policy.approval_status = 'approved'
        AND policy.commercial_use_allowed
        AND policy.redisplay_allowed
        AND 'production' = ANY(policy.enabled_environments)
        AND policy.expires_at > clock_timestamp()
    )
  ) THEN
    RAISE EXCEPTION
      'career source activation requires approved discovery, safe base URL, enabled provider, and current approved production policy'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION worker_private.career_source_runnable(
  p_source_id uuid,
  p_country_code text,
  p_mode text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, worker_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.career_sources AS source
    JOIN public.provider_registry AS registry
      ON registry.provider = source.provider
    JOIN public.source_policy AS policy
      ON policy.id = source.policy_id
     AND policy.provider = source.provider
    WHERE source.id = p_source_id
      AND p_country_code ~ '^[A-Za-z]{2}$'
      AND upper(p_country_code) = ANY(source.country_codes)
      AND p_mode IN ('incremental', 'backfill')
      AND source.discovery_state = 'approved'
      AND worker_private.career_source_base_url_is_safe(source.base_url)
      AND source.enabled
      AND source.transport_enabled
      AND CASE p_mode
        WHEN 'incremental' THEN source.incremental_enabled
        WHEN 'backfill' THEN source.backfill_enabled
        ELSE false
      END
      AND NOT coalesce(
        (source.country_kill_switches ->> upper(p_country_code))::boolean,
        false
      )
      AND NOT coalesce(
        (registry.country_kill_switches ->> upper(p_country_code))::boolean,
        false
      )
      AND registry.enabled
      AND registry.authorization_status = 'authorized'
      AND registry.writer_runtime = 'typescript'
      AND policy.enabled
      AND policy.approval_status = 'approved'
      AND policy.commercial_use_allowed
      AND policy.redisplay_allowed
      AND policy.full_text_retention_allowed
      AND 'production' = ANY(policy.enabled_environments)
      AND source.access_type = ANY(policy.permitted_access_methods)
      AND policy.expires_at > clock_timestamp()
  )
$$;

REVOKE ALL ON FUNCTION worker_private.career_source_base_url_is_safe(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, integer, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_private.approve_career_source_candidate(
  uuid, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.register_career_source_candidate(
  text, text, text, text, text, text[], text, text, integer, jsonb
) TO hirly_inventory_worker, hirly_inventory_operator;
GRANT EXECUTE ON FUNCTION worker_private.approve_career_source_candidate(
  uuid, text, uuid
) TO hirly_inventory_operator;

COMMIT;
