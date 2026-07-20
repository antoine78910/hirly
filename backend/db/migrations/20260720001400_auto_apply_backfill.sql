CREATE OR REPLACE FUNCTION public.backfill_auto_apply_queue(
  p_providers text[],
  p_limit integer DEFAULT 200
)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
SET lock_timeout = '1s'
AS $$
  WITH candidates AS (
    SELECT
      a.application_id,
      a.user_id,
      a.job_id,
      COALESCE(a.data ->> 'ats_provider', j.data ->> 'ats_provider') AS provider,
      EXISTS (
        SELECT 1
        FROM public.auto_apply_attempts aa
        WHERE aa.user_id = a.user_id
          AND aa.job_id = a.job_id
          AND aa.status = 'submitted_success'
      ) AS prior_success
    FROM public.applications a
    LEFT JOIN public.jobs j ON j.job_id = a.job_id
    WHERE a.data ->> 'package_status' IN ('generated', 'generated_text_only')
      AND COALESCE(a.data ->> 'submission_status', '') NOT IN ('submitted', 'expired')
      AND COALESCE(a.data ->> 'manual_status', '') NOT IN ('manually_submitted', 'offer_expired')
      AND COALESCE(a.data ->> 'auto_apply_queue_status', '') NOT IN
        ('queued', 'awaiting_review', 'running', 'succeeded')
      AND COALESCE(a.data ->> 'ats_provider', j.data ->> 'ats_provider')
        = ANY(COALESCE(p_providers, ARRAY[]::text[]))
    ORDER BY a.created_at NULLS LAST, a.application_id
    LIMIT LEAST(GREATEST(p_limit, 1), 200)
    FOR UPDATE OF a SKIP LOCKED
  ),
  fenced AS (
    UPDATE public.applications a
    SET data = a.data || jsonb_build_object(
      'auto_apply_queue_status', 'succeeded',
      'auto_apply_provider', c.provider,
      'auto_apply_queue_reason', 'prior_submitted_success',
      'auto_apply_finished_at', statement_timestamp(),
      'submission_status', 'submitted',
      'updated_at', statement_timestamp()
    )
    FROM candidates c
    WHERE c.prior_success
      AND a.application_id = c.application_id
    RETURNING a.application_id
  ),
  queued AS (
    UPDATE public.applications a
    SET data = a.data || jsonb_build_object(
      'auto_apply_queue_status', 'queued',
      'auto_apply_provider', c.provider,
      'auto_apply_queued_at', COALESCE(a.data -> 'auto_apply_queued_at', to_jsonb(statement_timestamp())),
      'auto_apply_queue_reason', 'queued',
      'auto_apply_started_at', NULL,
      'auto_apply_finished_at', NULL,
      'updated_at', statement_timestamp()
    )
    FROM candidates c
    WHERE NOT c.prior_success
      AND a.application_id = c.application_id
    RETURNING a.application_id
  )
  SELECT count(*)::integer FROM queued;
$$;

REVOKE ALL ON FUNCTION public.backfill_auto_apply_queue(text[], integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.backfill_auto_apply_queue(text[], integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.backfill_auto_apply_queue(text[], integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.backfill_auto_apply_queue(text[], integer) TO service_role;
  END IF;
END
$$;
