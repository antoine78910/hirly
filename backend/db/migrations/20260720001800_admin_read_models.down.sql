DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.admin_read_model_state
    WHERE singleton AND bootstrap_state='ready') THEN
    RAISE EXCEPTION 'refusing admin read-model down migration while cursor backend may be live';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS admin_jobs_project ON public.jobs;
  END IF;
END $$;
DROP TRIGGER IF EXISTS admin_applications_project ON public.applications;
DROP TRIGGER IF EXISTS admin_applications_users_insert ON public.applications;
DROP TRIGGER IF EXISTS admin_applications_users_update ON public.applications;
DROP TRIGGER IF EXISTS admin_applications_users_delete ON public.applications;
DROP TRIGGER IF EXISTS admin_swipes_users_insert ON public.swipes;
DROP TRIGGER IF EXISTS admin_swipes_users_update ON public.swipes;
DROP TRIGGER IF EXISTS admin_swipes_users_delete ON public.swipes;
DROP TRIGGER IF EXISTS admin_events_users_insert ON public.analytics_events;
DROP TRIGGER IF EXISTS admin_events_users_update ON public.analytics_events;
DROP TRIGGER IF EXISTS admin_events_users_delete ON public.analytics_events;
DROP TRIGGER IF EXISTS admin_users_rebuild_insert ON public.users;
DROP TRIGGER IF EXISTS admin_users_rebuild_update ON public.users;
DROP TRIGGER IF EXISTS admin_users_rebuild_delete ON public.users;
DROP TRIGGER IF EXISTS admin_profiles_rebuild_insert ON public.profiles;
DROP TRIGGER IF EXISTS admin_profiles_rebuild_update ON public.profiles;
DROP TRIGGER IF EXISTS admin_profiles_rebuild_delete ON public.profiles;
DROP TRIGGER IF EXISTS admin_application_rm_counter ON public.admin_application_read_model;
DROP FUNCTION IF EXISTS public.admin_users_cursor_v3(integer,timestamptz,text,text,text,boolean);
DROP FUNCTION IF EXISTS public.admin_user_analytics_cursor_v2(integer,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.admin_applications_cursor_v3(integer,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.admin_reconcile_read_models(boolean);
DROP FUNCTION IF EXISTS public.admin_backfill_users(text,integer);
DROP FUNCTION IF EXISTS public.admin_backfill_applications(text,integer);
DROP FUNCTION IF EXISTS public.admin_rebuild_application_scope_counts();
DROP FUNCTION IF EXISTS public.admin_assert_read_model_ready();
DROP FUNCTION IF EXISTS public.admin_refresh_user_application_facts_transition();
DROP FUNCTION IF EXISTS public.admin_rebuild_users_transition();
DROP FUNCTION IF EXISTS public.admin_job_row_project();
DROP FUNCTION IF EXISTS public.admin_application_row_project();
DROP FUNCTION IF EXISTS public.admin_refresh_user_identity(text[]);
DROP FUNCTION IF EXISTS public.admin_mark_canonical_change(text,text);
DROP FUNCTION IF EXISTS public.admin_rebuild_users(text[]);
DROP FUNCTION IF EXISTS public.admin_project_application(text);
DROP FUNCTION IF EXISTS public.admin_application_counter_trigger();
DROP FUNCTION IF EXISTS public.admin_application_scopes(text,text,text,text);
DROP TABLE IF EXISTS public.admin_application_scope_count;
DROP TABLE IF EXISTS public.admin_onboarding_answer_fact;
DROP TABLE IF EXISTS public.admin_application_read_model;
DROP TABLE IF EXISTS public.admin_user_read_model;
DROP TABLE IF EXISTS public.admin_read_model_watermark;
DROP TABLE IF EXISTS public.admin_read_model_state;
DROP FUNCTION IF EXISTS public.admin_normalize_missing_information(jsonb);
DROP FUNCTION IF EXISTS public.admin_onboarding_answers(jsonb);
DROP FUNCTION IF EXISTS public.admin_onboarding_answer_label(text,text);
DROP FUNCTION IF EXISTS public.admin_onboarding_answer_title(text);
DROP FUNCTION IF EXISTS public.admin_onboarding_step_label(text);
DROP FUNCTION IF EXISTS public.admin_try_boolean(text);
DROP FUNCTION IF EXISTS public.admin_try_bigint(text);
DROP FUNCTION IF EXISTS public.admin_try_timestamptz(text);
