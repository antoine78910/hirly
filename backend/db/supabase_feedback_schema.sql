-- User feedback (feature suggestions, training completion reviews).
-- Full payload lives in data jsonb (see feedback_store.py).

create table if not exists public.user_feedback (
    submission_id text primary key,
    feedback_type text,
    user_id text,
    user_email text,
    created_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists user_feedback_feedback_type_idx
    on public.user_feedback (feedback_type);

create index if not exists user_feedback_user_id_idx
    on public.user_feedback (user_id);

create index if not exists user_feedback_created_at_idx
    on public.user_feedback (created_at desc);

create index if not exists user_feedback_data_gin_idx
    on public.user_feedback using gin (data);
