BEGIN;

DROP FUNCTION IF EXISTS worker_private.approve_career_source_candidate(
  uuid, text, uuid
);

CREATE OR REPLACE FUNCTION worker_private.enforce_career_source_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.enabled AND NOT EXISTS (
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
  ) THEN
    RAISE EXCEPTION
      'career source activation requires an enabled provider and current approved production policy'
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

DROP FUNCTION IF EXISTS worker_private.career_source_base_url_is_safe(text);

COMMIT;
