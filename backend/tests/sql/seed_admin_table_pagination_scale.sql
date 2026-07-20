\set ON_ERROR_STOP on
\timing on

-- Disposable synthetic release-cardinality fixture:
-- 100,200 users, 5m applications, 5m swipes, and 5m analytics events.
SET synchronous_commit = off;
SET maintenance_work_mem = '1GB';

INSERT INTO public.users (user_id, email, name, data, created_at, updated_at)
SELECT
  'scale-user-' || lpad(g::text, 6, '0'),
  CASE WHEN g = 42 THEN 'selective-user@example.com'
    ELSE 'candidate-' || g || '@example.com' END,
  'Scale Candidate ' || g,
  jsonb_build_object(
    'billing', jsonb_build_object(
      'subscription_status', CASE WHEN g % 10 = 0 THEN 'active' ELSE 'none' END,
      'plan', CASE WHEN g % 10 = 0 THEN 'pro' ELSE 'free' END,
      'credits_total', 100,
      'credits_remaining', g % 100
    )
  ),
  timestamptz '2024-01-01' + (g || ' seconds')::interval,
  timestamptz '2026-01-01' + (g || ' seconds')::interval
FROM generate_series(1, 100200) g;

INSERT INTO public.profiles (
  user_id, target_role, target_location, data, created_at, updated_at
)
SELECT
  'scale-user-' || lpad(g::text, 6, '0'),
  CASE WHEN g % 2 = 0 THEN 'Engineer' ELSE 'Designer' END,
  CASE WHEN g % 3 = 0 THEN 'Paris' ELSE 'London' END,
  jsonb_build_object(
    'target_role', CASE WHEN g % 2 = 0 THEN 'Engineer' ELSE 'Designer' END,
    'target_location', CASE WHEN g % 3 = 0 THEN 'Paris' ELSE 'London' END,
    'extras', jsonb_build_object(
      'onboarding', jsonb_build_object(
        'job_search_status', 'active',
        'selected_roles', jsonb_build_array('Engineer'),
        'categories', jsonb_build_array('Technology')
      )
    )
  ),
  timestamptz '2024-01-01' + (g || ' seconds')::interval,
  timestamptz '2026-01-01' + (g || ' seconds')::interval
FROM generate_series(1, 100200) g;

INSERT INTO public.jobs (job_id, company, title, ats_provider, data, created_at, updated_at)
SELECT
  'scale-job-' || lpad(g::text, 5, '0'),
  'Scale Company ' || (g % 1000),
  CASE WHEN g % 2 = 0 THEN 'Engineer' ELSE 'Designer' END,
  CASE WHEN g % 3 = 0 THEN 'greenhouse' ELSE 'lever' END,
  '{}'::jsonb,
  '2025-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
FROM generate_series(1, 10000) g;

INSERT INTO public.applications (
  application_id, user_id, job_id, package_status, submission_status,
  status, data, created_at, updated_at
)
SELECT
  'scale-app-' || lpad(g::text, 7, '0'),
  'scale-user-' || lpad((((g - 1) % 100200) + 1)::text, 6, '0'),
  'scale-job-' || lpad((((g - 1) % 10000) + 1)::text, 5, '0'),
  CASE WHEN g % 3 = 0 THEN 'generated' ELSE 'not_generated' END,
  (ARRAY[
    'ready','prepared','submitted','failed','blocked','blocked_captcha',
    'prepare_failed','action_required','not_submitted'
  ])[1 + (g % 9)],
  NULL,
  jsonb_strip_nulls(jsonb_build_object(
    'manual_status', CASE WHEN g % 101 = 0 THEN
      (ARRAY[
        'manual_review_needed','manual_in_progress','manually_submitted',
        'manual_blocked','needs_user_input','offer_expired'
      ])[1 + (g % 6)] END,
    'auto_apply_queue_status', CASE WHEN g % 10000 = 0 THEN 'queued' END
  )),
  timestamptz '2025-01-01' + (g || ' seconds')::interval,
  timestamptz '2026-01-01' + (g || ' seconds')::interval
FROM generate_series(1, 5000000) g;

INSERT INTO public.swipes (
  swipe_id, user_id, direction, data, created_at, updated_at
)
SELECT
  'scale-swipe-' || lpad(g::text, 7, '0'),
  'scale-user-' || lpad((((g - 1) % 100200) + 1)::text, 6, '0'),
  CASE WHEN g % 2 = 0 THEN 'right' ELSE 'left' END,
  '{}'::jsonb,
  timestamptz '2025-06-01' + (g || ' seconds')::interval,
  timestamptz '2025-06-01' + (g || ' seconds')::interval
FROM generate_series(1, 5000000) g;

INSERT INTO public.analytics_events (event_id, user_id, event, data, created_at)
SELECT
  'scale-event-' || lpad(g::text, 7, '0'),
  'scale-user-' || lpad((((g - 1) % 100200) + 1)::text, 6, '0'),
  CASE
    WHEN g % 50 = 0 THEN 'onboarding_started'
    WHEN g % 50 = 1 THEN 'onboarding_step_completed'
    WHEN g % 50 = 2 THEN 'onboarding_completed'
    ELSE 'admin_scale_activity'
  END,
  CASE WHEN g % 50 = 1
    THEN jsonb_build_object('properties', jsonb_build_object(
      'step_index', g % 27,
      'step', 'step-' || (g % 27)
    ))
    ELSE '{}'::jsonb END,
  timestamptz '2025-03-01' + (g || ' seconds')::interval
FROM generate_series(1, 5000000) g;

ANALYZE public.users;
ANALYZE public.profiles;
ANALYZE public.jobs;
ANALYZE public.applications;
ANALYZE public.swipes;
ANALYZE public.analytics_events;

SELECT
  (SELECT count(*) FROM public.users) AS users,
  (SELECT count(*) FROM public.applications) AS applications,
  (SELECT count(*) FROM public.swipes) AS swipes,
  (SELECT count(*) FROM public.analytics_events) AS analytics_events;
