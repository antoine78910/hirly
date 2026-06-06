-- Phase 2 Supabase/Postgres schema for additional Mongo-shaped collections.
-- Auth collections are defined separately in supabase_auth_schema.sql.

create table if not exists public.profiles (
    user_id text primary key,
    target_role text,
    target_location text,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists profiles_target_role_idx
    on public.profiles (target_role);

create index if not exists profiles_data_gin_idx
    on public.profiles using gin (data);


create table if not exists public.swipes (
    swipe_id text primary key,
    user_id text,
    job_id text,
    direction text,
    created_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create unique index if not exists swipes_user_job_idx
    on public.swipes (user_id, job_id)
    where user_id is not null and job_id is not null;

create index if not exists swipes_user_created_at_idx
    on public.swipes (user_id, created_at desc);

create index if not exists swipes_data_gin_idx
    on public.swipes using gin (data);


create table if not exists public.applications (
    application_id text primary key,
    user_id text,
    job_id text,
    status text,
    package_status text,
    submission_status text,
    created_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

-- Mongo currently can contain multiple application package attempts for the
-- same user/job. Preserve all documents by keeping application_id as the only
-- uniqueness constraint for migration.
drop index if exists public.applications_user_job_idx;

create index if not exists applications_user_job_idx
    on public.applications (user_id, job_id)
    where user_id is not null and job_id is not null;

create index if not exists applications_user_created_at_idx
    on public.applications (user_id, created_at desc);

create index if not exists applications_submission_status_idx
    on public.applications (submission_status);

create index if not exists applications_data_gin_idx
    on public.applications using gin (data);


create table if not exists public.browser_submission_runs (
    run_id text primary key,
    application_id text,
    job_id text,
    user_id text,
    provider text,
    status text,
    dry_run boolean not null default false,
    created_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists browser_submission_runs_application_idx
    on public.browser_submission_runs (application_id);

create index if not exists browser_submission_runs_user_created_at_idx
    on public.browser_submission_runs (user_id, created_at desc);

create index if not exists browser_submission_runs_status_idx
    on public.browser_submission_runs (status);

create index if not exists browser_submission_runs_data_gin_idx
    on public.browser_submission_runs using gin (data);
