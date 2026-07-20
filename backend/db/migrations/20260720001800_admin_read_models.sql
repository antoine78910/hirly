-- Transactionally maintained, service-role-only admin read models.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.admin_try_timestamptz(p_value text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NULLIF(btrim(p_value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN p_value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow
  OR numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.admin_try_bigint(p_value text)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NULLIF(btrim(p_value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN p_value::bigint;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.admin_try_boolean(p_value text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NULLIF(btrim(p_value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN p_value::boolean;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.admin_onboarding_step_label(p_step text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public AS $$
  SELECT CASE p_step
    WHEN 'intro' THEN 'Intro slides' WHEN 'signup' THEN 'Sign up'
    WHEN 'jobSearch' THEN 'Job search status' WHEN 'jobGoal' THEN 'Job goal'
    WHEN 'compare2x' THEN '2× interviews comparison'
    WHEN 'contractType' THEN 'Contract type' WHEN 'otherApps' THEN 'Other apps used'
    WHEN 'longTerm' THEN 'Long-term results' WHEN 'categories' THEN 'Job categories'
    WHEN 'experience' THEN 'Experience level' WHEN 'location' THEN 'Target location'
    WHEN 'contactPhone' THEN 'Phone number' WHEN 'salary' THEN 'Salary expectations'
    WHEN 'interviews' THEN 'Interviews per week'
    WHEN 'jobTimeline' THEN 'Job search timeline'
    WHEN 'interviewsConfirm' THEN 'Interviews confirmation'
    WHEN 'jobBlocker' THEN 'Job search blocker'
    WHEN 'jobAccomplish' THEN 'Job search goal'
    WHEN 'potentialChart' THEN 'Interview potential'
    WHEN 'attribution' THEN 'Acquisition source' WHEN 'referralCode' THEN 'Referral code'
    WHEN 'upload' THEN 'CV upload' WHEN 'profileSetup' THEN 'Profile setup'
    WHEN 'profileWelcome' THEN 'Profile welcome'
    WHEN 'showcaseLanding' THEN 'Showcase — landing'
    WHEN 'showcaseAllInOne' THEN 'Showcase — all-in-one'
    WHEN 'showcasePricing' THEN 'Pricing / checkout' ELSE p_step END
$$;

CREATE OR REPLACE FUNCTION public.admin_onboarding_answer_title(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public AS $$
  SELECT CASE p_key
    WHEN 'job_search_status' THEN 'Are you looking for a job?'
    WHEN 'job_goal' THEN 'What''s your main goal?'
    WHEN 'contract_type' THEN 'Contract type'
    WHEN 'tried_other_apps' THEN 'Tried other job apps?'
    WHEN 'experience' THEN 'Experience level'
    WHEN 'job_timeline' THEN 'Target timeline'
    WHEN 'job_blocker' THEN 'Main blocker'
    WHEN 'job_accomplish' THEN 'What they want to accomplish'
    WHEN 'acquisition_source' THEN 'How they found us'
    WHEN 'selected_plan' THEN 'Plan picked at checkout'
    WHEN 'categories' THEN 'Job categories picked'
    WHEN 'selected_roles' THEN 'Roles picked'
    WHEN 'onboarding_location' THEN 'Where they search' ELSE p_key END
$$;

CREATE OR REPLACE FUNCTION public.admin_onboarding_answer_label(p_key text,p_value text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public AS $$
  SELECT CASE
    WHEN p_key='job_search_status' THEN CASE p_value
      WHEN 'yes' THEN 'Yes' WHEN 'kindof' THEN 'Kind of' WHEN 'no' THEN 'No' ELSE p_value END
    WHEN p_key='contract_type' THEN CASE p_value
      WHEN 'permanent' THEN 'Permanent contract (CDI)'
      WHEN 'fixed_term' THEN 'Fixed-term contract (CDD)'
      WHEN 'internship' THEN 'Internship' WHEN 'apprenticeship' THEN 'Apprenticeship'
      WHEN 'summer_job' THEN 'Summer job' WHEN 'part_time' THEN 'Part-time'
      WHEN 'seasonal' THEN 'Seasonal work' WHEN 'freelance' THEN 'Freelance / contract'
      ELSE p_value END
    WHEN p_key='tried_other_apps' THEN CASE p_value
      WHEN 'yes' THEN 'Yes' WHEN 'no' THEN 'No' ELSE p_value END
    WHEN p_key='job_goal' THEN CASE p_value
      WHEN 'asap' THEN 'Land a job ASAP' WHEN 'money' THEN 'Make more money'
      WHEN 'dream' THEN 'Land my dream job' ELSE p_value END
    WHEN p_key='job_timeline' THEN CASE p_value
      WHEN '1m' THEN '1 month' WHEN '3m' THEN '3 months'
      WHEN '6m' THEN '6 months' WHEN '12m' THEN '12 months+' ELSE p_value END
    WHEN p_key='job_blocker' THEN CASE p_value
      WHEN 'not_applying' THEN 'Not applying enough'
      WHEN 'no_interviews' THEN 'Can''t land interviews'
      WHEN 'not_ready' THEN 'Not ready yet'
      WHEN 'bad_offers' THEN 'Lack of great job offers' ELSE p_value END
    WHEN p_key='job_accomplish' THEN CASE p_value
      WHEN 'more_money' THEN 'Make a lot more money' WHEN 'family' THEN 'Support my family'
      WHEN 'exciting' THEN 'Find a job that excites me'
      WHEN 'time_back' THEN 'Get time back' ELSE p_value END
    WHEN p_key IN ('experience','seniority') THEN CASE p_value
      WHEN 'intern' THEN 'Internship' WHEN 'entry' THEN 'Entry level & graduate'
      WHEN 'junior' THEN 'Junior (1–2 years)' WHEN 'mid' THEN 'Mid level (3–5 years)'
      WHEN 'senior' THEN 'Senior (6–9 years)'
      WHEN 'lead' THEN 'Expert & leadership (10+ years)' ELSE p_value END
    WHEN p_key='acquisition_source' THEN CASE p_value
      WHEN 'social' THEN 'Social media' WHEN 'influencer' THEN 'Influencer'
      WHEN 'friend' THEN 'Friend / colleague' WHEN 'search' THEN 'Search'
      WHEN 'ads' THEN 'Advertisement' WHEN 'other' THEN 'Other' ELSE p_value END
    WHEN p_key='selected_plan' THEN CASE p_value
      WHEN 'quarterly' THEN 'Quarterly' WHEN 'monthly' THEN 'Monthly' ELSE p_value END
    ELSE p_value END
$$;

CREATE OR REPLACE FUNCTION public.admin_onboarding_answers(p_profile jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'job_search_status',p_profile#>>'{extras,onboarding,job_search_status}',
    'job_goal',p_profile#>>'{extras,onboarding,job_goal}',
    'onboarding_location',COALESCE(
      p_profile#>>'{extras,onboarding,onboarding_location}',p_profile->>'target_location'),
    'contract_type',COALESCE(
      p_profile#>>'{extras,onboarding,contract_type}',p_profile->>'contract_type'),
    'tried_other_apps',p_profile#>>'{extras,onboarding,tried_other_apps}',
    'categories',p_profile#>'{extras,onboarding,categories}',
    'suggested_categories',p_profile#>'{extras,onboarding,suggested_categories}',
    'selected_roles',COALESCE(
      p_profile#>'{extras,onboarding,selected_roles}',p_profile->'target_roles',
      CASE WHEN NULLIF(p_profile->>'target_role','') IS NOT NULL
        THEN jsonb_build_array(p_profile->>'target_role') END),
    'experience',COALESCE(
      p_profile#>>'{extras,onboarding,experience}',
      p_profile#>>'{extras,onboarding,seniority}',p_profile->>'seniority'),
    'seniority',COALESCE(
      p_profile#>>'{extras,onboarding,seniority}',p_profile->>'seniority'),
    'phone',COALESCE(
      p_profile#>>'{extras,onboarding,phone}',p_profile#>>'{contact,phone}'),
    'interviews_per_week',p_profile#>'{extras,onboarding,interviews_per_week}',
    'job_timeline',p_profile#>>'{extras,onboarding,job_timeline}',
    'job_blocker',p_profile#>>'{extras,onboarding,job_blocker}',
    'job_accomplish',p_profile#>>'{extras,onboarding,job_accomplish}',
    'acquisition_source',p_profile#>>'{extras,onboarding,acquisition_source}',
    'referral_code',p_profile#>>'{extras,onboarding,referral_code}',
    'salary_min',p_profile#>'{extras,onboarding,salary_min}',
    'salary_max',p_profile#>'{extras,onboarding,salary_max}',
    'selected_plan',p_profile#>>'{extras,onboarding,selected_plan}',
    'last_step',p_profile#>>'{extras,onboarding,last_step}',
    'job_priorities',p_profile#>'{extras,onboarding,job_priorities}'))
$$;

CREATE OR REPLACE FUNCTION public.admin_normalize_missing_information(p_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public AS $$
  WITH items AS (
    SELECT value item,ordinality ordinal FROM jsonb_array_elements(
      CASE jsonb_typeof(p_items)
        WHEN 'array' THEN p_items WHEN 'null' THEN '[]'::jsonb
        ELSE jsonb_build_array(p_items) END
    ) WITH ORDINALITY
  ), normalized AS (
    SELECT ordinal,jsonb_strip_nulls(CASE WHEN jsonb_typeof(item)='object' THEN
      jsonb_build_object(
        'field_name',COALESCE(NULLIF(item->>'field_name',''),NULLIF(item->>'name',''),
          NULLIF(item->>'label',''),'unknown_field'),
        'field_id',COALESCE(item->'field_id',item->'id'),
        'label',COALESCE(NULLIF(item->>'label',''),NULLIF(item->>'question',''),
          NULLIF(item->>'field_name',''),NULLIF(item->>'name',''),'Unknown field'),
        'question',COALESCE(NULLIF(item->>'question',''),NULLIF(item->>'label','')),
        'reason',COALESCE(NULLIF(item->>'reason',''),'missing_information'),
        'field_type',COALESCE(NULLIF(item->>'field_type',''),NULLIF(item->>'type',''),'input_text'),
        'type',COALESCE(NULLIF(item->>'type',''),NULLIF(item->>'field_type',''),'input_text'),
        'options',CASE WHEN jsonb_typeof(item->'options')='array'
          THEN item->'options' ELSE '[]'::jsonb END,
        'suggested_profile_key',item->'suggested_profile_key')
      ELSE jsonb_build_object(
        'field_name',regexp_replace(lower(btrim(item#>>'{}')),'[^a-z0-9]+','_','g'),
        'label',btrim(item#>>'{}'),'reason','missing_information',
        'field_type','input_text','options','[]'::jsonb) END) value
    FROM items WHERE item IS NOT NULL AND item<>'null'::jsonb
      AND NULLIF(btrim(item#>>'{}'),'') IS NOT NULL
  ), keyed AS (
    SELECT *,regexp_replace(lower(COALESCE(value->>'field_name',value->>'label','')),
      '[^a-z0-9]+','_','g') dedupe_key FROM normalized
  ), deduped AS (
    SELECT DISTINCT ON(dedupe_key) ordinal,value FROM keyed
    ORDER BY dedupe_key,ordinal
  )
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) FROM deduped
$$;

CREATE TABLE public.admin_user_read_model (
  user_id text PRIMARY KEY, email text, name text,
  demo_account boolean NOT NULL DEFAULT false, user_created_at timestamptz,
  subscription_status text NOT NULL DEFAULT 'none', plan text,
  is_premium boolean NOT NULL DEFAULT false,
  credits_total bigint NOT NULL DEFAULT 0 CHECK (credits_total >= 0),
  credits_remaining bigint NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
  profile_completion smallint NOT NULL DEFAULT 0 CHECK (profile_completion BETWEEN 0 AND 100),
  cv_uploaded boolean NOT NULL DEFAULT false, target_location text, target_role text,
  onboarding_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_started_at timestamptz, onboarding_completed_at timestamptz,
  furthest_step_index integer, furthest_step text, furthest_step_label text,
  drop_off_step text, drop_off_step_label text,
  total_applications bigint NOT NULL DEFAULT 0, total_swipes bigint NOT NULL DEFAULT 0,
  right_swipes bigint NOT NULL DEFAULT 0, left_swipes bigint NOT NULL DEFAULT 0,
  sessions_count integer NOT NULL DEFAULT 0,
  time_spent_minutes numeric(14,1) NOT NULL DEFAULT 0,
  last_application_at timestamptz, last_swipe_at timestamptz,
  last_event_at timestamptz, last_login_at timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT '-infinity',
  search_text text NOT NULL DEFAULT '', source_changed_at timestamptz,
  model_updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_user_rm_order_idx ON public.admin_user_read_model(last_active_at DESC,user_id ASC);
CREATE INDEX admin_user_rm_paying_order_idx ON public.admin_user_read_model(last_active_at DESC,user_id ASC) WHERE is_premium;
CREATE INDEX admin_user_rm_search_trgm_idx ON public.admin_user_read_model USING gin(search_text gin_trgm_ops);

CREATE TABLE public.admin_onboarding_answer_fact (
  user_id text NOT NULL, answer_key text NOT NULL, ordinal smallint NOT NULL,
  answer_value text NOT NULL, answer_label text NOT NULL,
  model_updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,answer_key,ordinal)
);
CREATE INDEX admin_answer_distribution_idx ON public.admin_onboarding_answer_fact(answer_key,answer_label,user_id);
CREATE INDEX admin_answer_user_idx ON public.admin_onboarding_answer_fact(user_id);

CREATE TABLE public.admin_application_read_model (
  application_id text PRIMARY KEY, user_id text, user_email text, job_id text,
  company text, title text, ats_provider text,
  submission_status text NOT NULL, user_facing_submission_status text NOT NULL,
  package_status text NOT NULL, admin_status text, manual_status text,
  assigned_to text, assigned_at timestamptz, created_at timestamptz,
  updated_at timestamptz, sort_at timestamptz NOT NULL DEFAULT '-infinity',
  has_tailored_resume boolean NOT NULL DEFAULT false,
  has_cover_letter boolean NOT NULL DEFAULT false, email_confirmed_outcome text,
  auto_apply_queue_status text, auto_apply_queue_reason text, auto_apply_provider text,
  prepared_missing_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz, source_changed_at timestamptz,
  model_updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_app_rm_order_idx ON public.admin_application_read_model(sort_at DESC,application_id ASC);
CREATE INDEX admin_app_rm_submission_idx ON public.admin_application_read_model(submission_status,sort_at DESC,application_id ASC);
CREATE INDEX admin_app_rm_manual_idx ON public.admin_application_read_model(manual_status,sort_at DESC,application_id ASC) WHERE manual_status IS NOT NULL;
CREATE INDEX admin_app_rm_user_facing_idx ON public.admin_application_read_model(user_facing_submission_status,sort_at DESC,application_id ASC);
CREATE INDEX admin_app_rm_queue_idx ON public.admin_application_read_model(sort_at DESC,application_id ASC)
  WHERE auto_apply_queue_status IN ('queued','running','awaiting_review');
CREATE INDEX admin_app_rm_user_idx ON public.admin_application_read_model(user_id);

CREATE TABLE public.admin_application_scope_count (
  scope_key text NOT NULL, bucket smallint NOT NULL CHECK(bucket BETWEEN 0 AND 63),
  total bigint NOT NULL DEFAULT 0 CHECK(total >= 0),
  model_updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(scope_key,bucket)
);
CREATE TABLE public.admin_read_model_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  schema_version integer NOT NULL,
  bootstrap_state text NOT NULL CHECK(bootstrap_state IN ('not_started','building','verifying','ready','failed')),
  bootstrap_started_at timestamptz, ready_at timestamptz, last_verified_at timestamptz,
  last_canonical_change_at timestamptz, last_model_change_at timestamptz,
  first_clean_reconciled_at timestamptz,
  first_clean_canonical_change_at timestamptz,
  clean_reconciliation_count smallint NOT NULL DEFAULT 0
    CHECK(clean_reconciliation_count BETWEEN 0 AND 2),
  users_rows bigint NOT NULL DEFAULT 0, applications_rows bigint NOT NULL DEFAULT 0,
  last_error text
);
INSERT INTO public.admin_read_model_state(singleton,schema_version,bootstrap_state,bootstrap_started_at)
VALUES(true,3,'building',clock_timestamp());
CREATE TABLE public.admin_read_model_watermark (
  source_key text NOT NULL,
  bucket integer NOT NULL CHECK(bucket BETWEEN 0 AND 131071),
  canonical_changed_at timestamptz NOT NULL,
  model_changed_at timestamptz NOT NULL,
  PRIMARY KEY(source_key,bucket)
);

CREATE OR REPLACE FUNCTION public.admin_application_scopes(
  p_submission text,p_manual text,p_user_facing text,p_queue text
) RETURNS SETOF text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT scope_key FROM (VALUES
    ('all',true),('action_required',p_submission='action_required'),
    ('blocked',p_submission='blocked'),('blocked_captcha',p_submission='blocked_captcha'),
    ('prepare_failed',p_submission='prepare_failed'),
    ('prepared',p_submission IN ('ready','prepared')),('ready',p_submission='ready'),
    ('submitted',p_submission='submitted'),('failed',p_submission='failed'),
    ('manual_review_needed',p_manual='manual_review_needed'),
    ('manual_in_progress',p_manual='manual_in_progress'),
    ('manually_submitted',p_manual='manually_submitted'),
    ('manual_blocked',p_manual='manual_blocked'),
    ('needs_user_input',p_manual='needs_user_input'),
    ('offer_expired',p_user_facing='expired'),
    ('queue_active',p_queue IN ('queued','running','awaiting_review'))
  ) AS membership(scope_key,is_member) WHERE is_member
$$;

CREATE OR REPLACE FUNCTION public.admin_application_counter_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET statement_timeout='2s' SET lock_timeout='1s' AS $$
DECLARE v_id text:=COALESCE(NEW.application_id,OLD.application_id);
  v_bucket smallint:=((hashtextextended(COALESCE(NEW.application_id,OLD.application_id),0)
    & 9223372036854775807)%64)::smallint;
BEGIN
  -- Bootstrap workers rebuild counters during reconciliation.  Skipping the
  -- shared scope rows here lets disjoint SKIP LOCKED batches commit or roll
  -- back independently instead of serializing behind another worker.
  IF current_setting('hirly.admin_backfill',true)='on' THEN
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF pg_trigger_depth()>2 THEN RAISE EXCEPTION 'admin projection trigger recursion'; END IF;
  IF TG_OP<>'INSERT' THEN
    UPDATE public.admin_application_scope_count c SET total=c.total-1,model_updated_at=clock_timestamp()
    WHERE c.bucket=v_bucket AND c.scope_key IN (
      SELECT s FROM public.admin_application_scopes(OLD.submission_status,OLD.manual_status,
        OLD.user_facing_submission_status,OLD.auto_apply_queue_status) s
      EXCEPT
      SELECT s FROM public.admin_application_scopes(NEW.submission_status,NEW.manual_status,
        NEW.user_facing_submission_status,NEW.auto_apply_queue_status) s WHERE TG_OP<>'DELETE'
    );
  END IF;
  IF TG_OP<>'DELETE' THEN
    INSERT INTO public.admin_application_scope_count(scope_key,bucket,total)
    SELECT s,v_bucket,1 FROM (
      SELECT s FROM public.admin_application_scopes(NEW.submission_status,NEW.manual_status,
        NEW.user_facing_submission_status,NEW.auto_apply_queue_status) s
      EXCEPT
      SELECT s FROM public.admin_application_scopes(OLD.submission_status,OLD.manual_status,
        OLD.user_facing_submission_status,OLD.auto_apply_queue_status) s WHERE TG_OP<>'INSERT'
    ) delta ORDER BY s
    ON CONFLICT(scope_key,bucket) DO UPDATE SET
      total=public.admin_application_scope_count.total+1,model_updated_at=clock_timestamp();
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER admin_application_rm_counter
AFTER INSERT OR UPDATE OR DELETE ON public.admin_application_read_model
FOR EACH ROW EXECUTE FUNCTION public.admin_application_counter_trigger();

CREATE OR REPLACE FUNCTION public.admin_rebuild_application_scope_counts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET statement_timeout='30s' SET lock_timeout='1s' AS $$
BEGIN
  DELETE FROM public.admin_application_scope_count;
  INSERT INTO public.admin_application_scope_count(scope_key,bucket,total)
  SELECT scope.scope_key,
    ((hashtextextended(r.application_id,0) & 9223372036854775807)%64)::smallint,
    count(*)
  FROM public.admin_application_read_model r
  CROSS JOIN LATERAL public.admin_application_scopes(
    r.submission_status,r.manual_status,r.user_facing_submission_status,
    r.auto_apply_queue_status
  ) AS scope(scope_key)
  GROUP BY scope.scope_key,
    ((hashtextextended(r.application_id,0) & 9223372036854775807)%64)::smallint;
END $$;

CREATE OR REPLACE FUNCTION public.admin_project_application(p_application_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET statement_timeout='5s' SET lock_timeout='1s' AS $$
DECLARE a record; d jsonb; v_submission text; v_package text; v_manual text;
  v_admin text; v_user_facing text; v_missing jsonb; v_has_questions boolean;
  v_manual_at timestamptz; v_admin_at timestamptz;
  v_created_at timestamptz; v_updated_at timestamptz;
BEGIN
  SELECT x.*,u.email user_email INTO a FROM public.applications x
  LEFT JOIN public.users u ON u.user_id=x.user_id
  WHERE x.application_id=p_application_id;
  IF NOT FOUND THEN DELETE FROM public.admin_application_read_model WHERE application_id=p_application_id; RETURN; END IF;
  d:=COALESCE(a.data,'{}');
  v_created_at:=public.admin_try_timestamptz(d->>'created_at');
  v_updated_at:=COALESCE(public.admin_try_timestamptz(d->>'updated_at'),v_created_at);
  v_submission:=COALESCE(NULLIF(d->>'submission_status',''),
    NULLIF(d->>'status',''),'not_submitted');
  v_package:=COALESCE(NULLIF(d->>'package_status',''),
    CASE WHEN COALESCE(d->'tailored_resume_structured' NOT IN
        ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false)
      OR COALESCE(d->'tailored_resume' NOT IN
        ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false)
      OR COALESCE(d->'tailored_cover_letter' NOT IN
        ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false)
      OR COALESCE(d->'cover_letter' NOT IN
        ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false)
      OR NULLIF(d->>'tailored_cv_file_b64','') IS NOT NULL THEN 'generated'
      ELSE 'not_generated' END);
  v_manual:=NULLIF(d->>'manual_status',''); v_admin:=NULLIF(d->>'admin_status','');
  v_manual_at:=public.admin_try_timestamptz(d->>'manual_status_updated_at');
  v_admin_at:=public.admin_try_timestamptz(d->>'admin_status_updated_at');
  v_missing:=public.admin_normalize_missing_information(
    d->'prepared_missing_information');
  v_has_questions:=v_missing<>'[]'::jsonb OR COALESCE(d->'required_questions','[]') NOT IN
    ('null'::jsonb,'[]'::jsonb,'{}'::jsonb,'""'::jsonb);
  IF v_admin IN ('manual_review_needed','manual_in_progress','manually_submitted','manual_blocked','needs_user_input','offer_expired')
    AND v_admin IS DISTINCT FROM v_manual AND v_admin_at IS NOT NULL
    AND (v_manual_at IS NULL OR v_admin_at>=v_manual_at) THEN v_manual:=v_admin;
  ELSIF COALESCE(v_manual,v_admin) IN ('manual_review_needed','manual_in_progress','manually_submitted','manual_blocked','needs_user_input','offer_expired')
    THEN v_manual:=COALESCE(v_manual,v_admin);
  ELSIF v_submission IN ('blocked_captcha','blocked') AND NOT v_has_questions THEN v_manual:=NULL;
  ELSIF v_submission IN ('prepare_failed','failed') AND NOT v_has_questions THEN v_manual:='manual_review_needed';
  ELSE v_manual:=NULL; END IF;
  v_user_facing:=CASE WHEN v_submission='blocked_captcha' THEN 'blocked_captcha'
    WHEN v_submission='blocked' AND NOT v_has_questions THEN 'blocked'
    WHEN v_manual='offer_expired' OR v_submission='expired' THEN 'expired'
    WHEN v_submission='submitted' OR v_manual='manually_submitted' THEN 'submitted'
    WHEN v_manual='needs_user_input' THEN 'action_required'
    WHEN d->>'auto_apply_queue_status' IN ('queued','running','awaiting_review') THEN 'pending'
    WHEN v_manual IN ('manual_review_needed','manual_in_progress','manual_blocked') THEN 'pending'
    ELSE v_submission END;
  INSERT INTO public.admin_application_read_model(
    application_id,user_id,user_email,job_id,company,title,ats_provider,submission_status,
    user_facing_submission_status,package_status,admin_status,manual_status,assigned_to,
    assigned_at,created_at,updated_at,sort_at,has_tailored_resume,has_cover_letter,
    email_confirmed_outcome,auto_apply_queue_status,auto_apply_queue_reason,
    auto_apply_provider,prepared_missing_information,submitted_at,source_changed_at)
  VALUES(a.application_id,a.user_id,a.user_email,a.job_id,
    NULLIF(d->>'company',''),NULLIF(d->>'title',''),
    COALESCE(NULLIF(d->>'submission_provider',''),NULLIF(d->>'ats_provider',''),
      NULLIF(d->>'auto_apply_provider','')),
    v_submission,v_user_facing,v_package,v_admin,v_manual,d->>'assigned_to',
    public.admin_try_timestamptz(d->>'assigned_at'),v_created_at,v_updated_at,
    COALESCE(v_updated_at,v_created_at,'-infinity'),
    COALESCE(d->'tailored_resume_structured' NOT IN
      ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false)
      OR COALESCE(d->'tailored_resume' NOT IN
      ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false),
    COALESCE(d->'tailored_cover_letter' NOT IN
      ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false)
      OR COALESCE(d->'cover_letter' NOT IN
      ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb),false),
    d->>'email_confirmed_outcome',NULLIF(d->>'auto_apply_queue_status',''),
    d->>'auto_apply_queue_reason',d->>'auto_apply_provider',v_missing,
    public.admin_try_timestamptz(d->>'submitted_at'),
    GREATEST(v_updated_at,v_created_at))
  ON CONFLICT(application_id) DO UPDATE SET
    user_id=EXCLUDED.user_id,user_email=EXCLUDED.user_email,job_id=EXCLUDED.job_id,
    company=EXCLUDED.company,title=EXCLUDED.title,ats_provider=EXCLUDED.ats_provider,
    submission_status=EXCLUDED.submission_status,
    user_facing_submission_status=EXCLUDED.user_facing_submission_status,
    package_status=EXCLUDED.package_status,admin_status=EXCLUDED.admin_status,
    manual_status=EXCLUDED.manual_status,assigned_to=EXCLUDED.assigned_to,
    assigned_at=EXCLUDED.assigned_at,created_at=EXCLUDED.created_at,
    updated_at=EXCLUDED.updated_at,sort_at=EXCLUDED.sort_at,
    has_tailored_resume=EXCLUDED.has_tailored_resume,has_cover_letter=EXCLUDED.has_cover_letter,
    email_confirmed_outcome=EXCLUDED.email_confirmed_outcome,
    auto_apply_queue_status=EXCLUDED.auto_apply_queue_status,
    auto_apply_queue_reason=EXCLUDED.auto_apply_queue_reason,
    auto_apply_provider=EXCLUDED.auto_apply_provider,
    prepared_missing_information=EXCLUDED.prepared_missing_information,
    submitted_at=EXCLUDED.submitted_at,source_changed_at=EXCLUDED.source_changed_at,
    model_updated_at=clock_timestamp();
END $$;

CREATE OR REPLACE FUNCTION public.admin_rebuild_users(p_user_ids text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET statement_timeout='10s' SET lock_timeout='1s' AS $$
BEGIN
  DELETE FROM public.admin_user_read_model r WHERE r.user_id=ANY(p_user_ids)
    AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.user_id=r.user_id);
  DELETE FROM public.admin_onboarding_answer_fact WHERE user_id=ANY(p_user_ids);
  WITH identities AS (
    SELECT u.user_id,u.email,u.data->>'name' name,
      public.admin_try_timestamptz(u.data->>'created_at') created_at,
      public.admin_try_timestamptz(u.data->>'updated_at') updated_at,
      u.data user_data,p.data profile_data,
      public.admin_try_timestamptz(p.data->>'updated_at') profile_updated_at
    FROM public.users u LEFT JOIN public.profiles p ON p.user_id=u.user_id
    WHERE u.user_id=ANY(p_user_ids)
  ), ordered_events AS (
    SELECT e.user_id,e.event,e.created_at,e.data,
      lag(e.created_at) OVER(PARTITION BY e.user_id ORDER BY e.created_at) previous_at
    FROM public.analytics_events e WHERE e.user_id=ANY(p_user_ids)
  ), session_events AS (
    SELECT e.*,sum(CASE WHEN previous_at IS NULL
      OR created_at-previous_at>interval '20 minutes' THEN 1 ELSE 0 END)
      OVER(PARTITION BY user_id ORDER BY created_at) session_number
    FROM ordered_events e
  ), session_spans AS (
    SELECT user_id,session_number,min(created_at) started_at,max(created_at) ended_at
    FROM session_events GROUP BY user_id,session_number
  ), event_sessions AS (
    SELECT user_id,count(*)::integer sessions_count,
      round(sum(GREATEST(0.5,extract(epoch FROM ended_at-started_at)/60.0))::numeric,1)
        time_spent_minutes
    FROM session_spans GROUP BY user_id
  ), event_progress AS (
    SELECT DISTINCT ON(user_id) user_id,
      public.admin_try_bigint(data#>>'{properties,step_index}')::integer furthest_step_index,
      data#>>'{properties,step}' furthest_step
    FROM ordered_events WHERE event='onboarding_step_completed'
      AND public.admin_try_bigint(data#>>'{properties,step_index}') IS NOT NULL
    ORDER BY user_id,public.admin_try_bigint(data#>>'{properties,step_index}') DESC,
      created_at DESC
  ), event_stats AS (
    SELECT e.user_id,max(e.created_at) last_event,
      min(e.created_at) FILTER(WHERE e.event='onboarding_started') onboarding_started_at,
      min(e.created_at) FILTER(WHERE e.event='onboarding_completed') onboarding_completed_at,
      p.furthest_step_index,p.furthest_step,
      CASE WHEN min(e.created_at) FILTER(WHERE e.event='onboarding_completed') IS NOT NULL
        THEN NULL
        WHEN p.furthest_step_index IS NOT NULL THEN
          (ARRAY['intro','signup','jobSearch','jobGoal','compare2x','contractType',
            'otherApps','longTerm','categories','experience','location','contactPhone',
            'salary','interviews','jobTimeline','interviewsConfirm','jobBlocker',
            'jobAccomplish','potentialChart','attribution','referralCode','upload',
            'profileSetup','profileWelcome','showcaseLanding','showcaseAllInOne',
            'showcasePricing'])[p.furthest_step_index+2]
        WHEN min(e.created_at) FILTER(WHERE e.event='onboarding_started') IS NOT NULL
          THEN 'intro' END drop_off_step
    FROM ordered_events e LEFT JOIN event_progress p USING(user_id)
    GROUP BY e.user_id,p.furthest_step_index,p.furthest_step
  ), facts AS (
    SELECT i.*,es.last_event,es.onboarding_started_at,es.onboarding_completed_at,
      es.furthest_step_index,es.furthest_step,es.drop_off_step,
      COALESCE(sess.sessions_count,0) sessions_count,
      COALESCE(sess.time_spent_minutes,0) time_spent_minutes,
      (SELECT count(*) FROM public.admin_application_read_model a WHERE a.user_id=i.user_id) app_count,
      (SELECT max(a.sort_at) FROM public.admin_application_read_model a WHERE a.user_id=i.user_id) last_app,
      (SELECT count(*) FROM public.swipes s WHERE s.user_id=i.user_id) swipe_count,
      (SELECT count(*) FROM public.swipes s WHERE s.user_id=i.user_id
        AND s.data->>'direction'='right') right_count,
      (SELECT count(*) FROM public.swipes s WHERE s.user_id=i.user_id
        AND s.data->>'direction'='left') left_count,
      (SELECT max(COALESCE(public.admin_try_timestamptz(s.data->>'updated_at'),
        public.admin_try_timestamptz(s.data->>'created_at')))
        FROM public.swipes s WHERE s.user_id=i.user_id) last_swipe
    FROM identities i LEFT JOIN event_stats es USING(user_id)
    LEFT JOIN event_sessions sess USING(user_id)
  )
  INSERT INTO public.admin_user_read_model(
    user_id,email,name,demo_account,user_created_at,subscription_status,plan,is_premium,
    credits_total,credits_remaining,profile_completion,cv_uploaded,target_location,target_role,
    onboarding_answers,onboarding_started_at,onboarding_completed_at,
    furthest_step_index,furthest_step,furthest_step_label,drop_off_step,
    drop_off_step_label,total_applications,total_swipes,right_swipes,left_swipes,
    sessions_count,time_spent_minutes,
    last_application_at,last_swipe_at,last_event_at,last_login_at,last_active_at,
    search_text,source_changed_at)
  SELECT user_id,email,name,COALESCE(public.admin_try_boolean(user_data->>'demo_account'),false),
    created_at,COALESCE(NULLIF(user_data#>>'{billing,subscription_status}',''),'none'),
    user_data#>>'{billing,plan}',COALESCE(user_data#>>'{billing,subscription_status}','none') IN ('active','trialing'),
    GREATEST(COALESCE(public.admin_try_bigint(user_data#>>'{billing,credits_total}'),0)
      +COALESCE(public.admin_try_bigint(user_data#>>'{billing,referral_bonus_credits_total}'),0),0),
    GREATEST(COALESCE(public.admin_try_bigint(user_data#>>'{billing,credits_remaining}'),0)
      +COALESCE(public.admin_try_bigint(user_data#>>'{billing,referral_bonus_credits_remaining}'),0),0),
    (25*((NULLIF(profile_data->>'cv_text','') IS NOT NULL OR NULLIF(profile_data->>'cv_filename','') IS NOT NULL)::int+
      (NULLIF(profile_data->>'target_role','') IS NOT NULL OR COALESCE(profile_data->'target_roles','[]')<>'[]')::int+
      (NULLIF(profile_data->>'target_location','') IS NOT NULL)::int+
      (COALESCE(profile_data->'application_answers_profile',profile_data->'application_defaults','{}')<>'{}')::int))::smallint,
    NULLIF(COALESCE(profile_data->>'cv_text',profile_data->>'cv_filename',profile_data->>'cv_storage_path'),'') IS NOT NULL,
    COALESCE(profile_data->>'target_location',profile_data#>>'{extras,onboarding,onboarding_location}'),
    COALESCE(profile_data->>'target_role',profile_data#>>'{extras,onboarding,selected_roles,0,label}'),
    public.admin_onboarding_answers(profile_data),
    onboarding_started_at,onboarding_completed_at,furthest_step_index,furthest_step,
    public.admin_onboarding_step_label(furthest_step),drop_off_step,
    public.admin_onboarding_step_label(drop_off_step),
    app_count,swipe_count,right_count,left_count,sessions_count,time_spent_minutes,
    last_app,last_swipe,last_event,
    public.admin_try_timestamptz(user_data->>'last_login_at'),
    GREATEST(COALESCE(last_app,'-infinity'),COALESCE(last_swipe,'-infinity'),
      COALESCE(last_event,'-infinity'),COALESCE(public.admin_try_timestamptz(user_data->>'last_login_at'),'-infinity'),
      COALESCE(profile_updated_at,'-infinity'),COALESCE(updated_at,'-infinity'),
      COALESCE(created_at,'-infinity')),
    lower(regexp_replace(concat_ws(' ',user_id,email,name,profile_data->>'target_location',
      profile_data->>'target_role',profile_data#>>'{extras,onboarding,job_search_status}',
      profile_data#>>'{extras,onboarding,selected_roles}',profile_data#>>'{extras,onboarding,categories}'),'\s+',' ','g')),
    GREATEST(created_at,updated_at,profile_updated_at,last_app,last_swipe,last_event)
  FROM facts
  ON CONFLICT(user_id) DO UPDATE SET
    email=EXCLUDED.email,name=EXCLUDED.name,demo_account=EXCLUDED.demo_account,
    user_created_at=EXCLUDED.user_created_at,subscription_status=EXCLUDED.subscription_status,
    plan=EXCLUDED.plan,is_premium=EXCLUDED.is_premium,credits_total=EXCLUDED.credits_total,
    credits_remaining=EXCLUDED.credits_remaining,profile_completion=EXCLUDED.profile_completion,
    cv_uploaded=EXCLUDED.cv_uploaded,target_location=EXCLUDED.target_location,
    target_role=EXCLUDED.target_role,onboarding_answers=EXCLUDED.onboarding_answers,
    onboarding_started_at=EXCLUDED.onboarding_started_at,
    onboarding_completed_at=EXCLUDED.onboarding_completed_at,
    furthest_step_index=EXCLUDED.furthest_step_index,
    furthest_step=EXCLUDED.furthest_step,
    furthest_step_label=EXCLUDED.furthest_step_label,
    drop_off_step=EXCLUDED.drop_off_step,
    drop_off_step_label=EXCLUDED.drop_off_step_label,
    total_applications=EXCLUDED.total_applications,total_swipes=EXCLUDED.total_swipes,
    right_swipes=EXCLUDED.right_swipes,left_swipes=EXCLUDED.left_swipes,
    sessions_count=EXCLUDED.sessions_count,time_spent_minutes=EXCLUDED.time_spent_minutes,
    last_application_at=EXCLUDED.last_application_at,last_swipe_at=EXCLUDED.last_swipe_at,
    last_event_at=EXCLUDED.last_event_at,last_login_at=EXCLUDED.last_login_at,
    last_active_at=EXCLUDED.last_active_at,search_text=EXCLUDED.search_text,
    source_changed_at=EXCLUDED.source_changed_at,model_updated_at=clock_timestamp();
  INSERT INTO public.admin_onboarding_answer_fact(user_id,answer_key,ordinal,answer_value,answer_label)
  SELECT r.user_id,e.key,0,left(e.value#>>'{}',512),
    left(public.admin_onboarding_answer_label(e.key,e.value#>>'{}'),512)
  FROM public.admin_user_read_model r CROSS JOIN LATERAL jsonb_each(r.onboarding_answers)e
  WHERE r.user_id=ANY(p_user_ids) AND jsonb_typeof(e.value) IN ('string','number','boolean')
    AND NULLIF(e.value#>>'{}','') IS NOT NULL
  UNION ALL
  SELECT r.user_id,e.key,(a.ordinality-1)::smallint,left(COALESCE(a.item->>'id',a.item->>'label',a.item#>>'{}'),512),
    left(COALESCE(a.item->>'label',a.item->>'id',a.item#>>'{}'),512)
  FROM public.admin_user_read_model r CROSS JOIN LATERAL jsonb_each(r.onboarding_answers)e
  CROSS JOIN LATERAL jsonb_array_elements(e.value) WITH ORDINALITY a(item,ordinality)
  WHERE r.user_id=ANY(p_user_ids) AND e.key IN ('categories','selected_roles');
END $$;

CREATE OR REPLACE FUNCTION public.admin_refresh_user_identity(p_user_ids text[])
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='1s' AS $$
  UPDATE public.admin_application_read_model r SET user_email=u.email,model_updated_at=clock_timestamp()
  FROM public.users u WHERE r.user_id=u.user_id AND u.user_id=ANY(p_user_ids)
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_canonical_change(
  p_source_key text,p_change_id text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='2s' SET lock_timeout='1s' AS $$
DECLARE v_changed_at timestamptz:=clock_timestamp();
  v_bucket integer:=((hashtextextended(COALESCE(p_change_id,''),0)
    & 9223372036854775807)%65536)::integer;
  v_overflow_bucket integer:=65536+
    ((txid_current()&9223372036854775807)%65536)::integer;
BEGIN
  BEGIN
    INSERT INTO public.admin_read_model_watermark(
      source_key,bucket,canonical_changed_at,model_changed_at)
    VALUES(p_source_key,v_bucket,v_changed_at,v_changed_at)
    ON CONFLICT(source_key,bucket) DO UPDATE SET
      canonical_changed_at=EXCLUDED.canonical_changed_at,
      model_changed_at=EXCLUDED.model_changed_at;
  EXCEPTION WHEN lock_not_available THEN
    INSERT INTO public.admin_read_model_watermark(
      source_key,bucket,canonical_changed_at,model_changed_at)
    VALUES(p_source_key,v_overflow_bucket,v_changed_at,v_changed_at)
    ON CONFLICT(source_key,bucket) DO UPDATE SET
      canonical_changed_at=GREATEST(
        public.admin_read_model_watermark.canonical_changed_at,
        EXCLUDED.canonical_changed_at),
      model_changed_at=GREATEST(
        public.admin_read_model_watermark.model_changed_at,
        EXCLUDED.model_changed_at);
  END;
END $$;

CREATE OR REPLACE FUNCTION public.admin_application_row_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.admin_project_application(COALESCE(NEW.application_id,OLD.application_id));
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER admin_applications_project AFTER INSERT OR UPDATE OR DELETE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.admin_application_row_project();

CREATE OR REPLACE FUNCTION public.admin_rebuild_users_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids text[];
BEGIN
  IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT user_id) INTO ids FROM new_rows;
  ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT user_id) INTO ids FROM old_rows;
  ELSE SELECT array_agg(DISTINCT user_id) INTO ids FROM
    (SELECT user_id FROM old_rows UNION SELECT user_id FROM new_rows)x; END IF;
  IF ids IS NOT NULL THEN PERFORM public.admin_rebuild_users(ids); END IF;
  IF TG_TABLE_NAME='users' AND TG_OP<>'DELETE' AND ids IS NOT NULL THEN
    PERFORM public.admin_refresh_user_identity(ids);
  END IF;
  PERFORM public.admin_mark_canonical_change(TG_TABLE_NAME,COALESCE(ids[1],TG_OP));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.admin_refresh_user_application_facts_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='1s' AS $$
DECLARE ids text[];
BEGIN
  IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT user_id) INTO ids FROM new_rows;
  ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT user_id) INTO ids FROM old_rows;
  ELSE SELECT array_agg(DISTINCT user_id) INTO ids FROM
    (SELECT user_id FROM old_rows UNION SELECT user_id FROM new_rows)x; END IF;
  IF TG_OP='INSERT' THEN
    WITH application_deltas AS (
      SELECT n.user_id,count(*) delta,max(a.sort_at) last_application_at
      FROM new_rows n JOIN public.admin_application_read_model a
        USING(application_id) GROUP BY n.user_id
    )
    UPDATE public.admin_user_read_model r SET
      total_applications=r.total_applications+d.delta,
      last_application_at=GREATEST(r.last_application_at,d.last_application_at),
      last_active_at=GREATEST(r.last_active_at,d.last_application_at),
      source_changed_at=GREATEST(r.source_changed_at,d.last_application_at),
      model_updated_at=clock_timestamp()
    FROM application_deltas d WHERE r.user_id=d.user_id;
  ELSE
    PERFORM 1 FROM public.admin_user_read_model
    WHERE user_id=ANY(COALESCE(ids,ARRAY[]::text[])) ORDER BY user_id FOR UPDATE;
    WITH application_facts AS (
      SELECT i.user_id,count(a.application_id) total_applications,
        max(a.sort_at) last_application_at
      FROM unnest(COALESCE(ids,ARRAY[]::text[])) i(user_id)
      LEFT JOIN public.admin_application_read_model a USING(user_id)
      GROUP BY i.user_id
    )
    UPDATE public.admin_user_read_model r SET
      total_applications=f.total_applications,
      last_application_at=f.last_application_at,
      last_active_at=GREATEST(COALESCE(f.last_application_at,'-infinity'),
        COALESCE(r.last_swipe_at,'-infinity'),COALESCE(r.last_event_at,'-infinity'),
        COALESCE(r.last_login_at,'-infinity'),
        COALESCE(public.admin_try_timestamptz(u.data->>'updated_at'),'-infinity'),
        COALESCE(public.admin_try_timestamptz(u.data->>'created_at'),'-infinity'),
        COALESCE(public.admin_try_timestamptz(p.data->>'updated_at'),'-infinity')),
      source_changed_at=GREATEST(f.last_application_at,r.last_swipe_at,r.last_event_at,
        r.last_login_at,public.admin_try_timestamptz(u.data->>'updated_at'),
        public.admin_try_timestamptz(u.data->>'created_at'),
        public.admin_try_timestamptz(p.data->>'updated_at')),
      model_updated_at=clock_timestamp()
    FROM application_facts f JOIN public.users u USING(user_id)
    LEFT JOIN public.profiles p USING(user_id)
    WHERE r.user_id=f.user_id;
  END IF;
  PERFORM public.admin_mark_canonical_change(TG_TABLE_NAME,COALESCE(ids[1],TG_OP));
  RETURN NULL;
END $$;

CREATE TRIGGER admin_applications_users_insert AFTER INSERT ON public.applications
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_refresh_user_application_facts_transition();
CREATE TRIGGER admin_applications_users_update AFTER UPDATE ON public.applications
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_refresh_user_application_facts_transition();
CREATE TRIGGER admin_applications_users_delete AFTER DELETE ON public.applications
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.admin_refresh_user_application_facts_transition();
CREATE TRIGGER admin_swipes_users_insert AFTER INSERT ON public.swipes
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_swipes_users_update AFTER UPDATE ON public.swipes
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_swipes_users_delete AFTER DELETE ON public.swipes
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_events_users_insert AFTER INSERT ON public.analytics_events
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_events_users_update AFTER UPDATE ON public.analytics_events
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_events_users_delete AFTER DELETE ON public.analytics_events
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_users_rebuild_insert AFTER INSERT ON public.users
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_users_rebuild_update AFTER UPDATE ON public.users
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_users_rebuild_delete AFTER DELETE ON public.users
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_profiles_rebuild_insert AFTER INSERT ON public.profiles
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_profiles_rebuild_update AFTER UPDATE ON public.profiles
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();
CREATE TRIGGER admin_profiles_rebuild_delete AFTER DELETE ON public.profiles
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.admin_rebuild_users_transition();

CREATE OR REPLACE FUNCTION public.admin_assert_read_model_ready()
RETURNS public.admin_read_model_state LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE s public.admin_read_model_state;
BEGIN
  SELECT * INTO s FROM public.admin_read_model_state WHERE singleton;
  SELECT GREATEST(s.last_canonical_change_at,max(w.canonical_changed_at)),
    GREATEST(s.last_model_change_at,max(w.model_changed_at))
  INTO s.last_canonical_change_at,s.last_model_change_at
  FROM public.admin_read_model_watermark w;
  IF s.bootstrap_state<>'ready' OR s.schema_version<>3
    OR s.applications_rows<0 OR s.users_rows<0
    OR (s.last_canonical_change_at IS NOT NULL AND
      s.last_canonical_change_at-COALESCE(s.last_model_change_at,'-infinity')>interval '30 seconds')
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='admin read model unavailable'; END IF;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.admin_users_cursor_v3(
 p_limit integer DEFAULT 100,p_cursor_time timestamptz DEFAULT NULL,p_cursor_id text DEFAULT NULL,
 p_direction text DEFAULT 'next',p_q text DEFAULT NULL,p_paying_only boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='10s' SET lock_timeout='1s'
SET work_mem='64MB' AS $$
DECLARE out jsonb; lim integer:=COALESCE(p_limit,100); q text;
  s public.admin_read_model_state;
BEGIN
 s:=public.admin_assert_read_model_ready();
 IF lim<1 OR lim>200 OR p_direction NOT IN ('next','previous')
   OR ((p_cursor_time IS NULL)<>(p_cursor_id IS NULL)) OR length(COALESCE(p_q,''))>128
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid admin cursor input'; END IF;
 q:=NULLIF(lower(regexp_replace(btrim(COALESCE(p_q,'')),'\s+',' ','g')),'');
 WITH matched AS NOT MATERIALIZED (
  SELECT * FROM public.admin_user_read_model r WHERE
   (q IS NULL OR r.search_text LIKE '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%' ESCAPE '\')
   AND (NOT COALESCE(p_paying_only,false) OR r.is_premium)
 ), candidates AS (
  SELECT * FROM matched r WHERE p_cursor_time IS NULL OR
   (p_direction='next' AND (r.last_active_at<p_cursor_time OR (r.last_active_at=p_cursor_time AND r.user_id>p_cursor_id))) OR
   (p_direction='previous' AND (r.last_active_at>p_cursor_time OR (r.last_active_at=p_cursor_time AND r.user_id<p_cursor_id)))
  ORDER BY CASE WHEN p_direction='next' THEN r.last_active_at END DESC,
   CASE WHEN p_direction='next' THEN r.user_id END ASC,
   CASE WHEN p_direction='previous' THEN r.last_active_at END ASC,
   CASE WHEN p_direction='previous' THEN r.user_id END DESC LIMIT lim+1
 ), page AS (SELECT * FROM candidates LIMIT lim),
 ordered AS (SELECT * FROM page ORDER BY last_active_at DESC,user_id ASC)
 SELECT jsonb_build_object('contract_version','admin-users-cursor/v3',
  'users',COALESCE(jsonb_agg(to_jsonb(ordered)-'search_text'),'[]'),'total',(SELECT count(*) FROM matched),
  'aggregates',jsonb_build_object('matching_paying',(SELECT count(*) FROM matched WHERE is_premium)),
  'has_previous',EXISTS(SELECT 1 FROM matched m WHERE
    (m.last_active_at>(SELECT last_active_at FROM ordered ORDER BY last_active_at DESC,user_id LIMIT 1)
     OR (m.last_active_at=(SELECT last_active_at FROM ordered ORDER BY last_active_at DESC,user_id LIMIT 1)
       AND m.user_id<(SELECT user_id FROM ordered ORDER BY last_active_at DESC,user_id LIMIT 1)))),
  'has_next',EXISTS(SELECT 1 FROM matched m WHERE
    (m.last_active_at<(SELECT last_active_at FROM ordered ORDER BY last_active_at,user_id DESC LIMIT 1)
     OR (m.last_active_at=(SELECT last_active_at FROM ordered ORDER BY last_active_at,user_id DESC LIMIT 1)
       AND m.user_id>(SELECT user_id FROM ordered ORDER BY last_active_at,user_id DESC LIMIT 1)))),
  'generated_at',clock_timestamp(),
  'model_updated_at',COALESCE(s.last_model_change_at,s.bootstrap_started_at,clock_timestamp()),
  'canonical_changed_at',COALESCE(s.last_canonical_change_at,s.last_model_change_at,s.bootstrap_started_at,clock_timestamp()),
  'freshness_lag_seconds',GREATEST(extract(epoch FROM
    COALESCE(s.last_canonical_change_at,s.last_model_change_at,s.bootstrap_started_at)-
    COALESCE(s.last_model_change_at,s.bootstrap_started_at)),0),
  'read_model_version',s.schema_version) INTO out FROM ordered;
 RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.admin_user_analytics_cursor_v2(
 p_limit integer DEFAULT 100,p_cursor_time timestamptz DEFAULT NULL,p_cursor_id text DEFAULT NULL,
 p_direction text DEFAULT 'next',p_q text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='10s' SET lock_timeout='1s'
SET work_mem='64MB' AS $$
DECLARE base jsonb; q text:=NULLIF(lower(regexp_replace(btrim(COALESCE(p_q,'')),'\s+',' ','g')),'');
BEGIN
 base:=public.admin_users_cursor_v3(p_limit,p_cursor_time,p_cursor_id,p_direction,p_q,false);
 RETURN (base-'contract_version'-'aggregates')||jsonb_build_object(
  'contract_version','admin-user-analytics-cursor/v2',
  'summary',(SELECT jsonb_build_object('total_users',count(*),
    'onboarding_completed',count(*) FILTER(WHERE onboarding_completed_at IS NOT NULL),
    'onboarding_in_progress',count(*) FILTER(WHERE onboarding_completed_at IS NULL
      AND drop_off_step IS NOT NULL),
    'onboarding_never_started',count(*) FILTER(WHERE onboarding_completed_at IS NULL
      AND drop_off_step IS NULL),
    'avg_time_spent_minutes',COALESCE(round(avg(time_spent_minutes),1),0),
    'total_swipes',COALESCE(sum(total_swipes),0),
    'total_applications',COALESCE(sum(total_applications),0))
    FROM public.admin_user_read_model r WHERE q IS NULL OR r.search_text LIKE
      '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%' ESCAPE '\'),
  'onboarding_dropoff',(WITH matched AS (
      SELECT * FROM public.admin_user_read_model r WHERE q IS NULL OR r.search_text LIKE
        '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%' ESCAPE '\'
    ), by_step AS (
      SELECT drop_off_step step,COALESCE(drop_off_step_label,drop_off_step) label,count(*) count
      FROM matched WHERE drop_off_step IS NOT NULL GROUP BY 1,2
    )
    SELECT jsonb_build_object(
      'by_step',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'step',step,'label',label,'count',count) ORDER BY count DESC,step) FROM by_step),'[]'),
      'never_started',count(*) FILTER(WHERE onboarding_completed_at IS NULL
        AND drop_off_step IS NULL),
      'in_progress',count(*) FILTER(WHERE onboarding_completed_at IS NULL
        AND drop_off_step IS NOT NULL),
      'completed',count(*) FILTER(WHERE onboarding_completed_at IS NOT NULL)) FROM matched),
  'answer_distributions',(WITH counts AS (
      SELECT f.answer_key,f.answer_label,count(*) count
      FROM public.admin_onboarding_answer_fact f
      JOIN public.admin_user_read_model r USING(user_id)
      WHERE q IS NULL OR r.search_text LIKE
        '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%' ESCAPE '\'
      GROUP BY 1,2
    ), totals AS (
      SELECT answer_key,sum(count) total FROM counts GROUP BY answer_key
    ), ranked AS (
      SELECT c.*,row_number() OVER(
        PARTITION BY c.answer_key ORDER BY c.count DESC,c.answer_label) option_rank
      FROM counts c
    ), distributions AS (
      SELECT c.answer_key,t.total,jsonb_agg(jsonb_build_object(
        'label',c.answer_label,'count',c.count,'pct',round(1000*c.count/t.total)/10.0)
        ORDER BY c.count DESC,c.answer_label) options
      FROM ranked c JOIN totals t USING(answer_key) WHERE c.option_rank<=6
      GROUP BY c.answer_key,t.total
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key',answer_key,'title',public.admin_onboarding_answer_title(answer_key),
      'total',total,'options',options)
      ORDER BY answer_key),'[]') FROM distributions));
END $$;

CREATE OR REPLACE FUNCTION public.admin_applications_cursor_v3(
 p_limit integer DEFAULT 100,p_cursor_time timestamptz DEFAULT NULL,p_cursor_id text DEFAULT NULL,
 p_direction text DEFAULT 'next',p_filter text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='10s' SET lock_timeout='1s'
SET work_mem='64MB' AS $$
DECLARE out jsonb; lim integer:=COALESCE(p_limit,100); f text:=NULLIF(lower(btrim(COALESCE(p_filter,''))),'');
  s public.admin_read_model_state;
BEGIN
 s:=public.admin_assert_read_model_ready();
 IF f='all' THEN f:=NULL; END IF;
 IF lim<1 OR lim>200 OR p_direction NOT IN ('next','previous')
   OR ((p_cursor_time IS NULL)<>(p_cursor_id IS NULL)) OR f IS NOT NULL AND f NOT IN
   ('action_required','blocked','blocked_captcha','prepare_failed','prepared','ready','submitted','failed',
    'manual_review_needed','manual_in_progress','manually_submitted','manual_blocked','needs_user_input','offer_expired')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid admin cursor input'; END IF;
 WITH matched AS NOT MATERIALIZED (
  SELECT * FROM public.admin_application_read_model r WHERE f IS NULL
   OR (f='prepared' AND r.submission_status IN ('ready','prepared'))
   OR (f='offer_expired' AND r.user_facing_submission_status='expired')
   OR (f IN ('manual_review_needed','manual_in_progress','manually_submitted','manual_blocked','needs_user_input') AND r.manual_status=f)
   OR r.submission_status=f
 ), candidates AS (
  SELECT * FROM matched r WHERE p_cursor_time IS NULL OR
   (p_direction='next' AND (r.sort_at<p_cursor_time OR (r.sort_at=p_cursor_time AND r.application_id>p_cursor_id))) OR
   (p_direction='previous' AND (r.sort_at>p_cursor_time OR (r.sort_at=p_cursor_time AND r.application_id<p_cursor_id)))
  ORDER BY CASE WHEN p_direction='next' THEN r.sort_at END DESC,
   CASE WHEN p_direction='next' THEN r.application_id END ASC,
   CASE WHEN p_direction='previous' THEN r.sort_at END ASC,
   CASE WHEN p_direction='previous' THEN r.application_id END DESC LIMIT lim+1
 ), page AS (SELECT * FROM candidates LIMIT lim),
 ordered AS (SELECT * FROM page ORDER BY sort_at DESC,application_id ASC),
 queue AS (SELECT * FROM public.admin_application_read_model
   WHERE auto_apply_queue_status IN ('queued','running','awaiting_review')
   ORDER BY sort_at DESC,application_id LIMIT 20)
 SELECT jsonb_build_object('contract_version','admin-applications-cursor/v3',
  'applications',COALESCE((SELECT jsonb_agg(to_jsonb(ordered)) FROM ordered),'[]'),
  'filter',COALESCE(f,'all'),
  'total',COALESCE((SELECT sum(total) FROM public.admin_application_scope_count
    WHERE scope_key=COALESCE(f,'all')),0),
  'has_previous',EXISTS(SELECT 1 FROM matched m WHERE
    m.sort_at>(SELECT sort_at FROM ordered ORDER BY sort_at DESC,application_id LIMIT 1)
    OR (m.sort_at=(SELECT sort_at FROM ordered ORDER BY sort_at DESC,application_id LIMIT 1)
      AND m.application_id<(SELECT application_id FROM ordered ORDER BY sort_at DESC,application_id LIMIT 1))),
  'has_next',EXISTS(SELECT 1 FROM matched m WHERE
    m.sort_at<(SELECT sort_at FROM ordered ORDER BY sort_at,application_id DESC LIMIT 1)
    OR (m.sort_at=(SELECT sort_at FROM ordered ORDER BY sort_at,application_id DESC LIMIT 1)
      AND m.application_id>(SELECT application_id FROM ordered ORDER BY sort_at,application_id DESC LIMIT 1))),
  'queue',jsonb_build_object('active_count',COALESCE((SELECT sum(total) FROM public.admin_application_scope_count
    WHERE scope_key='queue_active'),0),'items',COALESCE((SELECT jsonb_agg(to_jsonb(queue)-'sort_at') FROM queue),'[]')),
  'generated_at',clock_timestamp(),
  'model_updated_at',COALESCE(s.last_model_change_at,s.bootstrap_started_at,clock_timestamp()),
  'canonical_changed_at',COALESCE(s.last_canonical_change_at,s.last_model_change_at,s.bootstrap_started_at,clock_timestamp()),
  'freshness_lag_seconds',GREATEST(extract(epoch FROM
    COALESCE(s.last_canonical_change_at,s.last_model_change_at,s.bootstrap_started_at)-
    COALESCE(s.last_model_change_at,s.bootstrap_started_at)),0),
  'read_model_version',s.schema_version) INTO out;
 RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.admin_backfill_applications(
 p_after_application_id text DEFAULT NULL,p_limit integer DEFAULT 1000
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='30s' SET lock_timeout='1s' AS $$
DECLARE id text;n integer:=0;last_id text;remaining boolean;
  projected_ids text[]:=ARRAY[]::text[];affected_user_ids text[];
BEGIN
 PERFORM set_config('hirly.admin_backfill','on',true);
 -- The read-model row is the durable completion ledger.  Do not filter by the
 -- caller's high-water mark: another worker may have skipped a lower locked row
 -- and committed a higher one before dying.  A rolled-back projection remains
 -- absent and is therefore claimable by a later call.
 FOR id IN SELECT a.application_id FROM public.applications a
  LEFT JOIN public.admin_application_read_model r
    ON r.application_id=a.application_id
  WHERE r.application_id IS NULL
  ORDER BY a.application_id LIMIT LEAST(GREATEST(COALESCE(p_limit,1000),500),2000)
  FOR UPDATE OF a SKIP LOCKED LOOP
   PERFORM public.admin_project_application(id);
   projected_ids:=array_append(projected_ids,id);n:=n+1;last_id:=id;
 END LOOP;
 SELECT EXISTS(
  SELECT 1 FROM public.applications a
  LEFT JOIN public.admin_application_read_model r
    ON r.application_id=a.application_id
 WHERE r.application_id IS NULL
 ) INTO remaining;
 IF NOT remaining THEN
  PERFORM set_config('hirly.admin_backfill','off',true);
  PERFORM public.admin_rebuild_application_scope_counts();
  SELECT array_agg(u.user_id) INTO affected_user_ids FROM public.users u;
  IF affected_user_ids IS NOT NULL THEN
   PERFORM public.admin_rebuild_users(affected_user_ids);
  END IF;
 END IF;
 RETURN jsonb_build_object(
  'processed',n,'next_application_id',CASE WHEN remaining THEN last_id END,
  'remaining',remaining,'cursor_ignored',p_after_application_id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.admin_backfill_users(
 p_after_user_id text DEFAULT NULL,p_limit integer DEFAULT 500
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='30s' SET lock_timeout='1s' AS $$
DECLARE ids text[]; remaining boolean;
BEGIN
 PERFORM set_config('hirly.admin_backfill','on',true);
 SELECT array_agg(user_id ORDER BY user_id) INTO ids FROM (
  SELECT u.user_id FROM public.users u
  LEFT JOIN public.admin_user_read_model r ON r.user_id=u.user_id
  WHERE r.user_id IS NULL
  ORDER BY u.user_id LIMIT LEAST(GREATEST(COALESCE(p_limit,500),1),500)
  FOR UPDATE OF u SKIP LOCKED
 ) x;
 IF ids IS NOT NULL THEN PERFORM public.admin_rebuild_users(ids); END IF;
 SELECT EXISTS(
  SELECT 1 FROM public.users u
  LEFT JOIN public.admin_user_read_model r ON r.user_id=u.user_id
  WHERE r.user_id IS NULL
 ) INTO remaining;
 RETURN jsonb_build_object(
  'processed',COALESCE(cardinality(ids),0),
  'next_user_id',CASE WHEN remaining THEN ids[cardinality(ids)] END,
  'remaining',remaining,'cursor_ignored',p_after_user_id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.admin_reconcile_read_models(p_mark_ready boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET statement_timeout='30s' SET lock_timeout='1s' AS $$
DECLARE cu bigint;mu bigint;ca bigint;ma bigint;cc bigint;mc bigint;
  v_user_fact_mismatches bigint;v_scope_shard_mismatches bigint;
  v_queue_mismatches bigint;v_answer_mismatches bigint;
  v_application_hash_before text;v_application_hash_after text;
  v_user_hash_before text;v_user_hash_after text;
  v_sample_application_ids text[];v_sample_user_ids text[];
  v_probe_rollback boolean:=false;ok boolean;
  v_state public.admin_read_model_state;next_clean_count smallint;
  has_intervening_write boolean;
BEGIN
 SELECT * INTO v_state FROM public.admin_read_model_state WHERE singleton FOR UPDATE;
 SELECT GREATEST(v_state.last_canonical_change_at,max(w.canonical_changed_at)),
   GREATEST(v_state.last_model_change_at,max(w.model_changed_at))
 INTO v_state.last_canonical_change_at,v_state.last_model_change_at
 FROM public.admin_read_model_watermark w;
 SELECT count(*) INTO cu FROM public.users;
 SELECT count(*) INTO mu FROM public.admin_user_read_model;
 SELECT count(*) INTO ca FROM public.applications;
 SELECT count(*) INTO ma FROM public.admin_application_read_model;
 SELECT count(*) INTO cc FROM public.applications;
 SELECT COALESCE(sum(total),0) INTO mc
 FROM public.admin_application_scope_count WHERE scope_key='all';

 WITH application_facts AS (
   SELECT a.user_id,count(*) app_count,
     max(COALESCE(public.admin_try_timestamptz(a.data->>'updated_at'),
       public.admin_try_timestamptz(a.data->>'created_at'),'-infinity')) last_app
   FROM public.applications a GROUP BY a.user_id
 ), swipe_facts AS (
   SELECT s.user_id,count(*) swipe_count,
     count(*) FILTER(WHERE s.data->>'direction'='right') right_count,
     count(*) FILTER(WHERE s.data->>'direction'='left') left_count,
     max(COALESCE(public.admin_try_timestamptz(s.data->>'updated_at'),
       public.admin_try_timestamptz(s.data->>'created_at'))) last_swipe
   FROM public.swipes s GROUP BY s.user_id
 ), ordered_events AS (
   SELECT e.user_id,e.created_at,
     lag(e.created_at) OVER(PARTITION BY e.user_id ORDER BY e.created_at) previous_at
   FROM public.analytics_events e
 ), session_events AS (
   SELECT e.*,sum(CASE WHEN previous_at IS NULL
     OR created_at-previous_at>interval '20 minutes' THEN 1 ELSE 0 END)
     OVER(PARTITION BY user_id ORDER BY created_at) session_number
   FROM ordered_events e
 ), session_spans AS (
   SELECT user_id,session_number,min(created_at) started_at,max(created_at) ended_at
   FROM session_events GROUP BY user_id,session_number
 ), event_sessions AS (
   SELECT e.user_id,count(*)::integer sessions_count,
     round(sum(GREATEST(0.5,extract(epoch FROM e.ended_at-e.started_at)/60.0))::numeric,1)
       time_spent_minutes
   FROM session_spans e GROUP BY e.user_id
 ), event_facts AS (
   SELECT e.user_id,max(e.created_at) last_event,s.sessions_count,s.time_spent_minutes
   FROM ordered_events e JOIN event_sessions s USING(user_id)
   GROUP BY e.user_id,s.sessions_count,s.time_spent_minutes
 ), expected AS (
   SELECT u.user_id,COALESCE(a.app_count,0) total_applications,
     COALESCE(s.swipe_count,0) total_swipes,COALESCE(s.right_count,0) right_swipes,
     COALESCE(s.left_count,0) left_swipes,COALESCE(e.sessions_count,0) sessions_count,
     COALESCE(e.time_spent_minutes,0) time_spent_minutes,a.last_app last_application_at,
     s.last_swipe last_swipe_at,e.last_event last_event_at
   FROM public.users u LEFT JOIN application_facts a USING(user_id)
   LEFT JOIN swipe_facts s USING(user_id) LEFT JOIN event_facts e USING(user_id)
 )
 SELECT count(*) INTO v_user_fact_mismatches
 FROM expected e FULL JOIN public.admin_user_read_model r USING(user_id)
 WHERE e.user_id IS NULL OR r.user_id IS NULL
   OR e.total_applications IS DISTINCT FROM r.total_applications
   OR e.total_swipes IS DISTINCT FROM r.total_swipes
   OR e.right_swipes IS DISTINCT FROM r.right_swipes
   OR e.left_swipes IS DISTINCT FROM r.left_swipes
   OR e.sessions_count IS DISTINCT FROM r.sessions_count
   OR e.time_spent_minutes IS DISTINCT FROM r.time_spent_minutes
   OR e.last_application_at IS DISTINCT FROM r.last_application_at
   OR e.last_swipe_at IS DISTINCT FROM r.last_swipe_at
   OR e.last_event_at IS DISTINCT FROM r.last_event_at;

 WITH scopes(scope_key) AS (VALUES
   ('all'),('action_required'),('blocked'),('blocked_captcha'),('prepare_failed'),
   ('prepared'),('ready'),('submitted'),('failed'),('manual_review_needed'),
   ('manual_in_progress'),('manually_submitted'),('manual_blocked'),
   ('needs_user_input'),('offer_expired'),('queue_active')
 ), expected AS (
   SELECT s.scope_key,b.bucket,COALESCE(count(r.application_id),0) total
   FROM scopes s CROSS JOIN generate_series(0,63) b(bucket)
   LEFT JOIN public.admin_application_read_model r
     ON ((hashtextextended(r.application_id,0)&9223372036854775807)%64)::smallint=b.bucket
    AND s.scope_key IN (SELECT x FROM public.admin_application_scopes(
      r.submission_status,r.manual_status,r.user_facing_submission_status,
      r.auto_apply_queue_status)x)
   GROUP BY s.scope_key,b.bucket
 ), actual AS (
   SELECT e.scope_key,e.bucket,e.total expected_total,COALESCE(c.total,0) actual_total
   FROM expected e LEFT JOIN public.admin_application_scope_count c
     USING(scope_key,bucket)
 )
 SELECT count(*) INTO v_scope_shard_mismatches FROM actual
 WHERE expected_total IS DISTINCT FROM actual_total;

 SELECT count(*) INTO v_queue_mismatches FROM (
   SELECT count(*) expected_total FROM public.admin_application_read_model
   WHERE auto_apply_queue_status IN ('queued','running','awaiting_review')
 ) e CROSS JOIN (
   SELECT COALESCE(sum(total),0) actual_total FROM public.admin_application_scope_count
   WHERE scope_key='queue_active'
 ) a WHERE e.expected_total IS DISTINCT FROM a.actual_total;

 WITH expected_answers AS (
   SELECT p.user_id,e.key,0::smallint ordinal,left(e.value#>>'{}',512) answer_value,
     left(public.admin_onboarding_answer_label(e.key,e.value#>>'{}'),512) answer_label
   FROM public.profiles p CROSS JOIN LATERAL
     jsonb_each(public.admin_onboarding_answers(p.data))e
   WHERE jsonb_typeof(e.value) IN ('string','number','boolean')
     AND NULLIF(e.value#>>'{}','') IS NOT NULL
   UNION ALL
   SELECT p.user_id,e.key,(a.ordinality-1)::smallint,
     left(COALESCE(a.item->>'id',a.item->>'label',a.item#>>'{}'),512),
     left(COALESCE(a.item->>'label',a.item->>'id',a.item#>>'{}'),512)
   FROM public.profiles p CROSS JOIN LATERAL
     jsonb_each(public.admin_onboarding_answers(p.data))e
   CROSS JOIN LATERAL jsonb_array_elements(e.value) WITH ORDINALITY a(item,ordinality)
   WHERE e.key IN ('categories','selected_roles')
 ), differences AS (
   (SELECT * FROM expected_answers EXCEPT
    SELECT user_id,answer_key,ordinal,answer_value,answer_label
    FROM public.admin_onboarding_answer_fact)
   UNION ALL
   (SELECT user_id,answer_key,ordinal,answer_value,answer_label
    FROM public.admin_onboarding_answer_fact EXCEPT SELECT * FROM expected_answers)
 )
 SELECT count(*) INTO v_answer_mismatches FROM differences;

 SELECT array_agg(application_id ORDER BY application_id) INTO v_sample_application_ids
 FROM public.applications WHERE application_id IN (
   SELECT application_id FROM public.applications ORDER BY application_id LIMIT 1
 ) OR application_id IN (
   SELECT application_id FROM public.applications ORDER BY application_id DESC LIMIT 1
 ) OR ((hashtextextended(application_id,0)&9223372036854775807)%997)=0;
 SELECT array_agg(user_id ORDER BY user_id) INTO v_sample_user_ids
 FROM public.users WHERE user_id IN (
   SELECT user_id FROM public.users ORDER BY user_id LIMIT 1
 ) OR user_id IN (
   SELECT user_id FROM public.users ORDER BY user_id DESC LIMIT 1
 ) OR ((hashtextextended(user_id,0)&9223372036854775807)%997)=0;

 SELECT md5(COALESCE(string_agg((to_jsonb(r)-'model_updated_at')::text,''
   ORDER BY r.application_id),'')) INTO v_application_hash_before
 FROM public.admin_application_read_model r
 WHERE r.application_id=ANY(COALESCE(v_sample_application_ids,ARRAY[]::text[]));
 SELECT md5(COALESCE(string_agg(
   ((to_jsonb(r)-'model_updated_at')||jsonb_build_object('answers',
     COALESCE((SELECT jsonb_agg(to_jsonb(f)-'model_updated_at'
       ORDER BY f.answer_key,f.ordinal) FROM public.admin_onboarding_answer_fact f
       WHERE f.user_id=r.user_id),'[]'::jsonb)))::text,''
   ORDER BY r.user_id),'')) INTO v_user_hash_before
 FROM public.admin_user_read_model r
 WHERE r.user_id=ANY(COALESCE(v_sample_user_ids,ARRAY[]::text[]));

 BEGIN
   IF v_sample_application_ids IS NOT NULL THEN
     PERFORM public.admin_project_application(id) FROM unnest(v_sample_application_ids) id;
   END IF;
   IF v_sample_user_ids IS NOT NULL THEN
     PERFORM public.admin_rebuild_users(v_sample_user_ids);
   END IF;
   SELECT md5(COALESCE(string_agg((to_jsonb(r)-'model_updated_at')::text,''
     ORDER BY r.application_id),'')) INTO v_application_hash_after
   FROM public.admin_application_read_model r
   WHERE r.application_id=ANY(COALESCE(v_sample_application_ids,ARRAY[]::text[]));
   SELECT md5(COALESCE(string_agg(
     ((to_jsonb(r)-'model_updated_at')||jsonb_build_object('answers',
       COALESCE((SELECT jsonb_agg(to_jsonb(f)-'model_updated_at'
         ORDER BY f.answer_key,f.ordinal) FROM public.admin_onboarding_answer_fact f
         WHERE f.user_id=r.user_id),'[]'::jsonb)))::text,''
     ORDER BY r.user_id),'')) INTO v_user_hash_after
   FROM public.admin_user_read_model r
   WHERE r.user_id=ANY(COALESCE(v_sample_user_ids,ARRAY[]::text[]));
   v_probe_rollback:=true;
   RAISE EXCEPTION 'admin reconciliation semantic probe rollback';
 EXCEPTION WHEN raise_exception THEN
   IF NOT v_probe_rollback OR SQLERRM<>'admin reconciliation semantic probe rollback' THEN
     RAISE;
   END IF;
 END;
 ok:=cu=mu AND ca=ma AND cc=mc AND v_user_fact_mismatches=0
   AND v_scope_shard_mismatches=0 AND v_queue_mismatches=0
   AND v_answer_mismatches=0
   AND v_application_hash_before=v_application_hash_after
   AND v_user_hash_before=v_user_hash_after;
 has_intervening_write:=v_state.clean_reconciliation_count>0
  AND COALESCE(v_state.last_canonical_change_at,'-infinity')>
    COALESCE(v_state.first_clean_canonical_change_at,'-infinity');
 next_clean_count:=CASE
  WHEN NOT ok THEN 0
  WHEN v_state.clean_reconciliation_count=0 THEN 1
  WHEN has_intervening_write THEN 2
  ELSE 1
 END;
 UPDATE public.admin_read_model_state SET users_rows=mu,applications_rows=ma,
  last_canonical_change_at=v_state.last_canonical_change_at,
  last_model_change_at=v_state.last_model_change_at,
  bootstrap_state=CASE
    WHEN p_mark_ready AND ok AND next_clean_count=2 THEN 'ready'
    WHEN ok AND v_state.bootstrap_state='ready' AND next_clean_count=2 THEN 'ready'
    WHEN ok THEN 'verifying' ELSE 'failed' END,
  first_clean_reconciled_at=CASE
    WHEN NOT ok THEN NULL
    WHEN v_state.clean_reconciliation_count=0 THEN clock_timestamp()
    ELSE v_state.first_clean_reconciled_at END,
  first_clean_canonical_change_at=CASE
    WHEN NOT ok THEN NULL
    WHEN v_state.clean_reconciliation_count=0
      THEN COALESCE(v_state.last_canonical_change_at,'-infinity')
    ELSE v_state.first_clean_canonical_change_at END,
  clean_reconciliation_count=next_clean_count,
  last_verified_at=clock_timestamp(),
  ready_at=CASE WHEN p_mark_ready AND ok AND next_clean_count=2
    THEN clock_timestamp() ELSE ready_at END,
  last_error=CASE WHEN ok THEN NULL ELSE 'read model reconciliation mismatch' END WHERE singleton;
 RETURN jsonb_build_object('ok',ok,'canonical_users',cu,'model_users',mu,
  'canonical_applications',ca,'model_applications',ma,'counter_applications',mc,
  'user_fact_mismatches',v_user_fact_mismatches,
  'scope_shard_mismatches',v_scope_shard_mismatches,
  'queue_mismatches',v_queue_mismatches,'answer_mismatches',v_answer_mismatches,
  'application_semantic_hash',v_application_hash_before,
  'user_semantic_hash',v_user_hash_before,
  'semantic_hashes_match',v_application_hash_before=v_application_hash_after
    AND v_user_hash_before=v_user_hash_after,
  'clean_reconciliation_count',next_clean_count,
  'intervening_normal_write',has_intervening_write,
  'ready',p_mark_ready AND ok AND next_clean_count=2);
END $$;

ALTER TABLE public.admin_user_read_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_onboarding_answer_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_application_read_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_application_scope_count ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_read_model_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_read_model_watermark ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_user_read_model,public.admin_onboarding_answer_fact,
 public.admin_application_read_model,public.admin_application_scope_count,
 public.admin_read_model_state,public.admin_read_model_watermark FROM PUBLIC;

DO $$
DECLARE role_name text; fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature); END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.admin_user_read_model,public.admin_onboarding_answer_fact,public.admin_application_read_model,public.admin_application_scope_count,public.admin_read_model_state,public.admin_read_model_watermark FROM %I',role_name);
   FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'admin_%'
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn.signature,role_name); END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.admin_user_read_model,public.admin_onboarding_answer_fact,
    public.admin_application_read_model,public.admin_application_scope_count,
    public.admin_read_model_state,public.admin_read_model_watermark FROM service_role;
  FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'admin_try_timestamptz','admin_try_bigint','admin_try_boolean',
      'admin_onboarding_step_label','admin_onboarding_answer_title',
      'admin_onboarding_answer_label','admin_onboarding_answers',
      'admin_normalize_missing_information',
      'admin_application_scopes','admin_application_counter_trigger',
      'admin_project_application','admin_rebuild_users','admin_refresh_user_identity',
      'admin_mark_canonical_change',
      'admin_application_row_project','admin_job_row_project',
      'admin_rebuild_users_transition','admin_refresh_user_application_facts_transition',
      'admin_assert_read_model_ready',
      'admin_backfill_applications','admin_backfill_users',
      'admin_reconcile_read_models','admin_users_cursor_v3',
      'admin_user_analytics_cursor_v2','admin_applications_cursor_v3')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role',fn.signature); END LOOP;
  GRANT EXECUTE ON FUNCTION public.admin_users_cursor_v3(integer,timestamptz,text,text,text,boolean) TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_user_analytics_cursor_v2(integer,timestamptz,text,text,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_applications_cursor_v3(integer,timestamptz,text,text,text) TO service_role;
 END IF;
END $$;
