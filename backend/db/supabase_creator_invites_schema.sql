-- Creator invitation codes (training / demo access links).
-- Full invite payload lives in data jsonb (see creator_invite_store.py).

create table if not exists public.creator_invites (
    invite_id text primary key,
    code text not null,
    influencer_id text,
    invite_type text,
    course_id text,
    redeemed_by_user_id text,
    created_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create unique index if not exists creator_invites_code_idx
    on public.creator_invites (code);

create index if not exists creator_invites_influencer_id_idx
    on public.creator_invites (influencer_id);

create index if not exists creator_invites_invite_type_idx
    on public.creator_invites (invite_type);

create index if not exists creator_invites_data_gin_idx
    on public.creator_invites using gin (data);
