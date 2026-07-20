\set ON_ERROR_STOP on
\timing on

-- Disposable release-cardinality fixture. Canonical triggers are disabled only
-- while bulk-loading synthetic history; separate fixtures exercise maintenance.
SET synchronous_commit=off;
SET maintenance_work_mem='1GB';
SET work_mem='128MB';

ALTER TABLE public.applications DISABLE TRIGGER admin_applications_project;
ALTER TABLE public.applications DISABLE TRIGGER admin_applications_users_insert;
ALTER TABLE public.applications DISABLE TRIGGER admin_applications_users_update;
ALTER TABLE public.applications DISABLE TRIGGER admin_applications_users_delete;
ALTER TABLE public.swipes DISABLE TRIGGER admin_swipes_users_insert;
ALTER TABLE public.swipes DISABLE TRIGGER admin_swipes_users_update;
ALTER TABLE public.swipes DISABLE TRIGGER admin_swipes_users_delete;
ALTER TABLE public.analytics_events DISABLE TRIGGER admin_events_users_insert;
ALTER TABLE public.analytics_events DISABLE TRIGGER admin_events_users_update;
ALTER TABLE public.analytics_events DISABLE TRIGGER admin_events_users_delete;
ALTER TABLE public.users DISABLE TRIGGER admin_users_rebuild_insert;
ALTER TABLE public.users DISABLE TRIGGER admin_users_rebuild_update;
ALTER TABLE public.users DISABLE TRIGGER admin_users_rebuild_delete;
ALTER TABLE public.profiles DISABLE TRIGGER admin_profiles_rebuild_insert;
ALTER TABLE public.profiles DISABLE TRIGGER admin_profiles_rebuild_update;
ALTER TABLE public.profiles DISABLE TRIGGER admin_profiles_rebuild_delete;
ALTER TABLE public.admin_application_read_model DISABLE TRIGGER admin_application_rm_counter;

INSERT INTO public.users(user_id,email,data)
SELECT 'scale-user-'||lpad(g::text,6,'0'),
  CASE WHEN g=42 THEN 'selective-user@example.com' ELSE 'candidate-'||g||'@example.com' END,
  jsonb_build_object(
    'name','Scale Candidate '||g,
    'created_at',to_char(timestamptz '2024-01-01'+g*interval '1 second',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at',to_char(timestamptz '2024-01-01'+g*interval '1 second',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'billing',jsonb_build_object(
      'subscription_status',CASE WHEN g%10=0 THEN 'active' ELSE 'none' END))
FROM generate_series(1,100200) g;

INSERT INTO public.profiles(user_id,data)
SELECT 'scale-user-'||lpad(g::text,6,'0'),jsonb_build_object(
  'target_role',CASE WHEN g%2=0 THEN 'Engineer' ELSE 'Designer' END,
  'target_location',CASE WHEN g%3=0 THEN 'Paris' ELSE 'London' END,
  'extras',jsonb_build_object('onboarding',jsonb_build_object(
    'job_search_status','active','categories',jsonb_build_array('Technology'),
    'selected_roles',jsonb_build_array('Engineer'))))
FROM generate_series(1,100200) g;

INSERT INTO public.applications(application_id,user_id,job_id,data)
SELECT 'scale-app-'||lpad(g::text,7,'0'),
 'scale-user-'||lpad((((g-1)%100200)+1)::text,6,'0'),
 'scale-job-'||lpad((((g-1)%10000)+1)::text,5,'0'),
 jsonb_strip_nulls(jsonb_build_object(
   'package_status',CASE WHEN g%3=0 THEN 'generated' ELSE 'not_generated' END,
   'submission_status',(ARRAY['ready','prepared','submitted','failed','blocked','blocked_captcha',
     'prepare_failed','action_required','not_submitted'])[1+(g%9)],
   'created_at',to_char(timestamptz '2025-01-01'+g*interval '1 second',
     'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'updated_at',to_char(timestamptz '2026-01-01'+g*interval '1 second',
     'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'manual_status',CASE WHEN g%101=0 THEN
    (ARRAY['manual_review_needed','manual_in_progress','manually_submitted',
      'manual_blocked','needs_user_input','offer_expired'])[1+(g%6)] END,
   'auto_apply_queue_status',CASE WHEN g%10000=0 THEN 'queued' END))
FROM generate_series(1,5000000) g;

INSERT INTO public.swipes(user_id,job_id,data)
SELECT 'scale-user-'||lpad((((g-1)%100200)+1)::text,6,'0'),
 'scale-swipe-job-'||lpad(g::text,7,'0'),
 jsonb_build_object(
  'direction',CASE WHEN g%2=0 THEN 'right' ELSE 'left' END,
  'created_at',to_char(timestamptz '2025-06-01'+g*interval '1 second',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'updated_at',to_char(timestamptz '2025-06-01'+g*interval '1 second',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
FROM generate_series(1,5000000) g;

INSERT INTO public.analytics_events(event_id,user_id,event,created_at,data)
SELECT 'scale-event-'||lpad(g::text,7,'0'),
 'scale-user-'||lpad((((g-1)%100200)+1)::text,6,'0'),
 CASE WHEN g%50=0 THEN 'onboarding_started' ELSE 'admin_scale_activity' END,
 timestamptz '2025-03-01'+g*interval '1 second','{}'
FROM generate_series(1,5000000) g;

INSERT INTO public.admin_application_read_model(
 application_id,user_id,user_email,job_id,submission_status,user_facing_submission_status,
 package_status,manual_status,created_at,updated_at,sort_at,auto_apply_queue_status,
 prepared_missing_information,source_changed_at)
SELECT a.application_id,a.user_id,u.email,a.job_id,a.data->>'submission_status',
 CASE WHEN a.data->>'submission_status'='submitted' THEN 'submitted'
      WHEN a.data->>'manual_status'='offer_expired' THEN 'expired'
      WHEN a.data->>'auto_apply_queue_status'='queued' THEN 'pending'
      ELSE a.data->>'submission_status' END,
 a.data->>'package_status',a.data->>'manual_status',
 public.admin_try_timestamptz(a.data->>'created_at'),
 public.admin_try_timestamptz(a.data->>'updated_at'),
 public.admin_try_timestamptz(a.data->>'updated_at'),
 a.data->>'auto_apply_queue_status','[]',public.admin_try_timestamptz(a.data->>'updated_at')
FROM public.applications a JOIN public.users u USING(user_id);

CREATE TEMP TABLE scale_app_stats AS
SELECT user_id,count(*) total,max(public.admin_try_timestamptz(data->>'updated_at')) last_at
FROM public.applications GROUP BY user_id;
CREATE TEMP TABLE scale_swipe_stats AS
SELECT user_id,count(*) total,count(*) FILTER(WHERE data->>'direction'='right') rights,
 count(*) FILTER(WHERE data->>'direction'='left') lefts,
 max(public.admin_try_timestamptz(data->>'created_at')) last_at
FROM public.swipes GROUP BY user_id;
CREATE TEMP TABLE scale_event_stats AS
SELECT user_id,max(created_at) last_at,count(*)::integer sessions_count,
 round((count(*) * 0.5)::numeric,1) time_spent_minutes
FROM public.analytics_events GROUP BY user_id;

INSERT INTO public.admin_user_read_model(
 user_id,email,name,user_created_at,subscription_status,is_premium,profile_completion,
 target_location,target_role,
 onboarding_answers,total_applications,total_swipes,right_swipes,left_swipes,
 sessions_count,time_spent_minutes,last_application_at,last_swipe_at,last_event_at,last_active_at,
 search_text,source_changed_at)
SELECT u.user_id,u.email,u.data->>'name',public.admin_try_timestamptz(u.data->>'created_at'),
 COALESCE(u.data#>>'{billing,subscription_status}','none'),
 COALESCE(u.data#>>'{billing,subscription_status}','none') IN ('active','trialing'),
 50,p.data->>'target_location',p.data->>'target_role',public.admin_onboarding_answers(p.data),
 a.total,s.total,s.rights,s.lefts,e.sessions_count,e.time_spent_minutes,
 a.last_at,s.last_at,e.last_at,
 GREATEST(a.last_at,s.last_at,e.last_at,public.admin_try_timestamptz(u.data->>'created_at')),
 lower(concat_ws(' ',u.user_id,u.email,u.data->>'name',p.data->>'target_location',
   p.data->>'target_role',p.data#>>'{extras,onboarding,job_search_status}',
   p.data#>>'{extras,onboarding,selected_roles}',p.data#>>'{extras,onboarding,categories}')),
 GREATEST(a.last_at,s.last_at,e.last_at,public.admin_try_timestamptz(u.data->>'created_at'))
FROM public.users u JOIN public.profiles p USING(user_id)
JOIN scale_app_stats a USING(user_id) JOIN scale_swipe_stats s USING(user_id)
JOIN scale_event_stats e USING(user_id);

INSERT INTO public.admin_onboarding_answer_fact(user_id,answer_key,ordinal,answer_value,answer_label)
SELECT user_id,'job_search_status',0,'active','active' FROM public.users
UNION ALL SELECT user_id,'categories',0,'Technology','Technology' FROM public.users
UNION ALL SELECT user_id,'selected_roles',0,'Engineer','Engineer' FROM public.users
UNION ALL SELECT user_id,'onboarding_location',0,'London','London' FROM public.users;

INSERT INTO public.admin_application_scope_count(scope_key,bucket,total)
SELECT scope_key,((hashtextextended(application_id,0)&9223372036854775807)%64)::smallint,count(*)
FROM public.admin_application_read_model r
CROSS JOIN LATERAL public.admin_application_scopes(
 r.submission_status,r.manual_status,r.user_facing_submission_status,r.auto_apply_queue_status) scope_key
GROUP BY 1,2;

UPDATE public.admin_read_model_state SET bootstrap_state='ready',
 ready_at=clock_timestamp(),last_verified_at=clock_timestamp(),
 last_canonical_change_at=clock_timestamp(),last_model_change_at=clock_timestamp(),
 users_rows=100200,applications_rows=5000000,last_error=NULL WHERE singleton;

ALTER TABLE public.applications ENABLE TRIGGER admin_applications_project;
ALTER TABLE public.applications ENABLE TRIGGER admin_applications_users_insert;
ALTER TABLE public.applications ENABLE TRIGGER admin_applications_users_update;
ALTER TABLE public.applications ENABLE TRIGGER admin_applications_users_delete;
ALTER TABLE public.swipes ENABLE TRIGGER admin_swipes_users_insert;
ALTER TABLE public.swipes ENABLE TRIGGER admin_swipes_users_update;
ALTER TABLE public.swipes ENABLE TRIGGER admin_swipes_users_delete;
ALTER TABLE public.analytics_events ENABLE TRIGGER admin_events_users_insert;
ALTER TABLE public.analytics_events ENABLE TRIGGER admin_events_users_update;
ALTER TABLE public.analytics_events ENABLE TRIGGER admin_events_users_delete;
ALTER TABLE public.users ENABLE TRIGGER admin_users_rebuild_insert;
ALTER TABLE public.users ENABLE TRIGGER admin_users_rebuild_update;
ALTER TABLE public.users ENABLE TRIGGER admin_users_rebuild_delete;
ALTER TABLE public.profiles ENABLE TRIGGER admin_profiles_rebuild_insert;
ALTER TABLE public.profiles ENABLE TRIGGER admin_profiles_rebuild_update;
ALTER TABLE public.profiles ENABLE TRIGGER admin_profiles_rebuild_delete;
ALTER TABLE public.admin_application_read_model ENABLE TRIGGER admin_application_rm_counter;

ANALYZE public.admin_user_read_model;
ANALYZE public.admin_onboarding_answer_fact;
ANALYZE public.admin_application_read_model;
ANALYZE public.admin_application_scope_count;
ANALYZE public.users;
ANALYZE public.applications;
ANALYZE public.swipes;
ANALYZE public.analytics_events;

SELECT (SELECT count(*) FROM public.users) users,
 (SELECT count(*) FROM public.applications) applications,
 (SELECT count(*) FROM public.swipes) swipes,
 (SELECT count(*) FROM public.analytics_events) analytics_events,
 (SELECT count(*) FROM public.admin_user_read_model) model_users,
 (SELECT count(*) FROM public.admin_application_read_model) model_applications;
