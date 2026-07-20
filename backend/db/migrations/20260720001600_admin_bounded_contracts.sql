-- Default-off, service-role-only bounded admin read contracts.
CREATE OR REPLACE FUNCTION public.admin_overview_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
  SELECT jsonb_build_object(
    'metrics', jsonb_build_object(
      'total_users', (SELECT count(*) FROM public.users),
      'new_users_today', (SELECT count(*) FROM public.users WHERE created_at >= date_trunc('day', clock_timestamp())),
      'applications_today', (SELECT count(*) FROM public.applications WHERE created_at >= date_trunc('day', clock_timestamp())),
      'prepared_applications', (SELECT count(*) FROM public.applications WHERE submission_status IN ('ready','prepared')),
      'action_required', (SELECT count(*) FROM public.applications WHERE submission_status = 'action_required'),
      'failed_blocked', (SELECT count(*) FROM public.applications WHERE submission_status IN ('failed','blocked','blocked_captcha','prepare_failed')),
      'submitted', (SELECT count(*) FROM public.applications WHERE submission_status = 'submitted')
    ),
    'top_blockers', '[]'::jsonb,
    'latest_attention', '[]'::jsonb,
    'generated_at', clock_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_analytics_snapshot(p_window_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
  WITH bounded AS (
    SELECT GREATEST(1, LEAST(COALESCE(p_window_days, 30), 365)) AS days
  )
  SELECT jsonb_build_object(
    'metrics', jsonb_build_object(
      'signups', (SELECT count(*) FROM public.users, bounded WHERE created_at >= clock_timestamp() - make_interval(days => bounded.days)),
      'applications_generated', (SELECT count(*) FROM public.applications, bounded WHERE created_at >= clock_timestamp() - make_interval(days => bounded.days)),
      'prepared', (SELECT count(*) FROM public.applications, bounded WHERE submission_status IN ('ready','prepared') AND created_at >= clock_timestamp() - make_interval(days => bounded.days)),
      'submitted', (SELECT count(*) FROM public.applications, bounded WHERE submission_status = 'submitted' AND created_at >= clock_timestamp() - make_interval(days => bounded.days))
    ),
    'conversion_funnel', '[]'::jsonb,
    'onboarding_dropoff', jsonb_build_object('by_step','[]'::jsonb,'never_started',0,'in_progress',0,'completed',0),
    'cta_analytics', '[]'::jsonb,
    'application_funnel', '{}'::jsonb,
    'by_ats', '{}'::jsonb,
    'ats_performance', '{}'::jsonb,
    'time_series', '{}'::jsonb,
    'admin_ops', '{}'::jsonb,
    'events_available', false,
    'generated_at', clock_timestamp(),
    'window_days', (SELECT days FROM bounded)
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_users_page(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_window_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
  WITH bounds AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit,100),1),500) lim,
           GREATEST(COALESCE(p_offset,0),0) off,
           GREATEST(1,LEAST(COALESCE(p_window_days,30),365)) days
  ), page AS (
    SELECT left(u.user_id::text,128) user_id,
           left(u.email::text,320) email,
           left(u.name::text,256) name,
           u.created_at,
           COALESCE((SELECT count(*) FROM public.applications a WHERE a.user_id=u.user_id),0) total_applications,
           COALESCE((SELECT count(*) FROM public.swipes s WHERE s.user_id=u.user_id),0) total_swipes
    FROM public.users u, bounds
    WHERE u.created_at >= clock_timestamp() - make_interval(days => bounds.days)
    ORDER BY u.created_at DESC, u.user_id
    LIMIT (SELECT lim FROM bounds) OFFSET (SELECT off FROM bounds)
  )
  SELECT jsonb_build_object(
    'users', COALESCE(jsonb_agg(to_jsonb(page)), '[]'::jsonb),
    'page', ((SELECT off FROM bounds) / (SELECT lim FROM bounds)) + 1,
    'page_size', (SELECT lim FROM bounds),
    'generated_at', clock_timestamp()
  ) FROM page;
$$;

CREATE OR REPLACE FUNCTION public.admin_applications_page(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_window_days integer DEFAULT 30,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
  WITH bounds AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit,100),1),500) lim,
           GREATEST(COALESCE(p_offset,0),0) off,
           GREATEST(1,LEAST(COALESCE(p_window_days,30),365)) days
  ), page AS (
    SELECT left(a.application_id::text,128) application_id,
           left(a.user_id::text,128) user_id,
           left(u.email::text,320) user_email,
           left(a.job_id::text,128) job_id,
           left(j.company::text,256) company,
           left(j.title::text,512) title,
           left(j.ats_provider::text,64) ats_provider,
           left(a.submission_status::text,64) submission_status,
           left(a.package_status::text,64) package_status,
           left(a.status::text,64) status,
           a.created_at, a.updated_at, a.submitted_at
    FROM public.applications a
    LEFT JOIN public.users u ON u.user_id=a.user_id
    LEFT JOIN public.jobs j ON j.job_id=a.job_id
    CROSS JOIN bounds
    WHERE a.created_at >= clock_timestamp() - make_interval(days => bounds.days)
      AND (p_status IS NULL OR a.submission_status=p_status)
    ORDER BY a.updated_at DESC NULLS LAST, a.application_id
    LIMIT (SELECT lim FROM bounds) OFFSET (SELECT off FROM bounds)
  )
  SELECT jsonb_build_object(
    'applications', COALESCE(jsonb_agg(to_jsonb(page)), '[]'::jsonb),
    'filter', left(COALESCE(p_status,'all'),64),
    'page', ((SELECT off FROM bounds) / (SELECT lim FROM bounds)) + 1,
    'page_size', (SELECT lim FROM bounds),
    'generated_at', clock_timestamp()
  ) FROM page;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_overview_snapshot()',
    'admin_analytics_snapshot(integer)',
    'admin_users_page(integer,integer,integer)',
    'admin_applications_page(integer,integer,integer,text)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || fn || ' FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || fn || ' FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || fn || ' FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || fn || ' TO service_role';
  END LOOP;
END $$;
