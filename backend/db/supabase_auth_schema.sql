-- Final auth Supabase/Postgres schema for Mongo-shaped auth collections.
-- Full Mongo documents are preserved in data jsonb.

create table if not exists public.users (
    user_id text primary key,
    email text,
    name text,
    created_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create unique index if not exists users_email_idx
    on public.users (email)
    where email is not null;

create index if not exists users_created_at_idx
    on public.users (created_at desc);

create index if not exists users_data_gin_idx
    on public.users using gin (data);


create table if not exists public.user_sessions (
    session_token text primary key,
    user_id text,
    expires_at timestamptz,
    created_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists user_sessions_user_id_idx
    on public.user_sessions (user_id);

create index if not exists user_sessions_expires_at_idx
    on public.user_sessions (expires_at);

create index if not exists user_sessions_data_gin_idx
    on public.user_sessions using gin (data);
