-- Supabase/Postgres schema for jobs and company board collections.

create table if not exists public.jobs (
    job_id text primary key,
    provider text,
    external_id text,
    ats_provider text,
    auto_apply_supported boolean not null default false,
    company text,
    title text,
    location text,
    country_code text,
    remote boolean not null default false,
    posted_at timestamptz,
    imported_at timestamptz,
    last_seen_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create unique index if not exists jobs_provider_external_id_idx
    on public.jobs (provider, external_id)
    where provider is not null and external_id is not null;

create index if not exists jobs_ats_auto_apply_idx
    on public.jobs (ats_provider, auto_apply_supported);

create index if not exists jobs_company_idx
    on public.jobs (company);

create index if not exists jobs_country_code_idx
    on public.jobs (country_code);

create index if not exists jobs_imported_at_idx
    on public.jobs (imported_at desc);

create index if not exists jobs_data_gin_idx
    on public.jobs using gin (data);


create table if not exists public.company_boards (
    board_id text primary key,
    ats_provider text,
    company text,
    board_token text,
    enabled boolean not null default true,
    priority integer,
    last_synced_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create unique index if not exists company_boards_ats_board_token_idx
    on public.company_boards (ats_provider, board_token)
    where ats_provider is not null and board_token is not null;

create index if not exists company_boards_enabled_priority_idx
    on public.company_boards (enabled, priority desc);

create index if not exists company_boards_last_synced_at_idx
    on public.company_boards (last_synced_at);

create index if not exists company_boards_data_gin_idx
    on public.company_boards using gin (data);
