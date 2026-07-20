\set ON_ERROR_STOP on

INSERT INTO public.users(user_id,email,data)
SELECT 'semantic-user-'||g,'semantic-'||g||'@example.com',
  jsonb_build_object('name','Semantic User '||g,'created_at','2026-01-01T00:00:00Z')
FROM generate_series(0,7) g;

INSERT INTO public.profiles(user_id,data)
SELECT 'semantic-user-'||g,jsonb_build_object(
  'target_location','Paris',
  'target_roles',jsonb_build_array('Fallback Role'),
  'contract_type','permanent',
  'seniority','senior',
  'contact',jsonb_build_object('phone','+33123456789'),
  'extras',jsonb_build_object('onboarding',jsonb_build_object('job_goal','goal_'||g))
)
FROM generate_series(0,7) g;

INSERT INTO public.analytics_events(event_id,user_id,event,created_at,data) VALUES
  ('semantic-start','semantic-user-0','onboarding_started','2026-01-02T00:00:00Z','{}');

INSERT INTO public.jobs(job_id,title,company,ats_provider,data)
VALUES ('semantic-job','Engineer','Semantic Co','greenhouse','{}');

INSERT INTO public.applications(application_id,user_id,job_id,data) VALUES
  ('semantic-array','semantic-user-0','semantic-job',
    '{"submission_status":"failed","created_at":"2026-01-03T00:00:00Z",
      "prepared_missing_information":["Visa status",
        {"field_name":"visa_status","label":"Duplicate visa"},
        {"name":"portfolio","label":"Portfolio","options":["URL","PDF"]}]}'),
  ('semantic-object','semantic-user-0','semantic-job',
    '{"submission_status":"failed","created_at":"2026-01-03T00:00:00Z",
      "prepared_missing_information":{"name":"work permit","label":"Work permit"}}'),
  ('semantic-string','semantic-user-0','semantic-job',
    '{"submission_status":"failed","created_at":"2026-01-03T00:00:00Z",
      "prepared_missing_information":"Sponsorship"}');

SELECT public.admin_reconcile_read_models(true);
INSERT INTO users(user_id,email,data)
VALUES ('semantic-readiness-probe','semantic-probe@example.com','{}');
DELETE FROM users WHERE user_id='semantic-readiness-probe';
SELECT public.admin_reconcile_read_models(true);

DO $$
DECLARE payload jsonb; distribution jsonb; answers jsonb;
BEGIN
  SELECT public.admin_user_analytics_cursor_v2(200,NULL,NULL,'next',NULL) INTO payload;
  SELECT item INTO distribution FROM jsonb_array_elements(payload->'answer_distributions') item
  WHERE item->>'key'='job_goal';
  IF distribution->>'title'<>'What''s your main goal?'
    OR jsonb_array_length(distribution->'options')<>6
    OR distribution#>>'{options,0,label}'<>'goal_0'
    OR (distribution->>'total')::integer<>8 THEN
    RAISE EXCEPTION 'top-six/title/tie semantic parity failed: %',distribution;
  END IF;
  IF payload#>>'{summary,onboarding_in_progress}'<>'1'
    OR payload#>>'{summary,onboarding_never_started}'<>'7'
    OR payload#>>'{onboarding_dropoff,by_step,0,label}'<>'Intro slides' THEN
    RAISE EXCEPTION 'onboarding terminal/label semantic parity failed: %',payload;
  END IF;
  SELECT onboarding_answers INTO answers FROM public.admin_user_read_model
  WHERE user_id='semantic-user-1';
  IF answers->>'onboarding_location'<>'Paris'
    OR answers#>>'{selected_roles,0}'<>'Fallback Role'
    OR answers->>'contract_type'<>'permanent'
    OR answers->>'experience'<>'senior'
    OR answers->>'phone'<>'+33123456789' THEN
    RAISE EXCEPTION 'onboarding fallback semantic parity failed: %',answers;
  END IF;
  IF (SELECT jsonb_array_length(prepared_missing_information)
      FROM public.admin_application_read_model WHERE application_id='semantic-array')<>2
    OR (SELECT jsonb_array_length(prepared_missing_information)
      FROM public.admin_application_read_model WHERE application_id='semantic-object')<>1
    OR (SELECT jsonb_array_length(prepared_missing_information)
      FROM public.admin_application_read_model WHERE application_id='semantic-string')<>1 THEN
    RAISE EXCEPTION 'missing-information normalization/deduplication parity failed';
  END IF;
END $$;
