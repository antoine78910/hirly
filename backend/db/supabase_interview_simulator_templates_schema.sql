-- Shared MP3 interview-simulator templates for /record-tools.
-- Full template payload (segments, split settings, filenames, ...) lives in data jsonb
-- (see record_tools_service.py). The audio file itself stays on local disk.

create table if not exists public.interview_simulator_templates (
    template_id text primary key,
    created_by_user_id text,
    created_at timestamptz,
    updated_at timestamptz,
    data jsonb not null default '{}'::jsonb,
    migrated_at timestamptz not null default now()
);

create index if not exists interview_simulator_templates_created_by_user_id_idx
    on public.interview_simulator_templates (created_by_user_id);

create index if not exists interview_simulator_templates_created_at_idx
    on public.interview_simulator_templates (created_at);

create index if not exists interview_simulator_templates_data_gin_idx
    on public.interview_simulator_templates using gin (data);
