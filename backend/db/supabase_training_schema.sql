-- Training platform tables (separate from core Swiipr user/job data).
-- Creators live in training_creators; learners use users + training_enrollments.

create table if not exists public.training_creators (
    creator_id text primary key,
    user_id text not null unique,
    email text,
    display_name text,
    created_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists training_creators_user_id_idx
    on public.training_creators (user_id);

create index if not exists training_creators_data_gin_idx
    on public.training_creators using gin (data);


create table if not exists public.training_courses (
    course_id text primary key,
    creator_id text not null,
    title text,
    status text not null default 'draft',
    published boolean not null default false,
    created_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists training_courses_creator_id_idx
    on public.training_courses (creator_id);

create index if not exists training_courses_status_idx
    on public.training_courses (status);

create index if not exists training_courses_published_idx
    on public.training_courses (published);

create index if not exists training_courses_data_gin_idx
    on public.training_courses using gin (data);


create table if not exists public.training_modules (
    module_id text primary key,
    course_id text not null,
    title text,
    sort_order integer not null default 0,
    duration_seconds integer,
    created_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists training_modules_course_id_idx
    on public.training_modules (course_id, sort_order);

create index if not exists training_modules_data_gin_idx
    on public.training_modules using gin (data);


create table if not exists public.training_enrollments (
    enrollment_id text primary key,
    user_id text not null,
    course_id text not null,
    progress_percent integer not null default 0,
    completed_module_ids jsonb not null default '[]'::jsonb,
    -- Also stores quiz_results, activity, quiz_attempts_log (see training_service.py)
    enrolled_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create unique index if not exists training_enrollments_user_course_idx
    on public.training_enrollments (user_id, course_id);

create index if not exists training_enrollments_user_id_idx
    on public.training_enrollments (user_id);

create index if not exists training_enrollments_course_id_idx
    on public.training_enrollments (course_id);

create index if not exists training_enrollments_data_gin_idx
    on public.training_enrollments using gin (data);


create table if not exists public.training_crm_leads (
    lead_id text primary key,
    creator_id text not null,
    email text,
    name text,
    stage text not null default 'new',
    source text,
    created_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists training_crm_leads_creator_id_idx
    on public.training_crm_leads (creator_id);

create index if not exists training_crm_leads_stage_idx
    on public.training_crm_leads (stage);

create index if not exists training_crm_leads_data_gin_idx
    on public.training_crm_leads using gin (data);
