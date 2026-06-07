# Database Schema

Runtime database: Supabase/Postgres.

The backend uses a jsonb-preserving table design. Each table stores:

- A primary key column.
- Selected top-level columns used for common filters and ordering.
- A `data jsonb` column containing the full application document.
- `migrated_at timestamptz default now()`.

The active adapter restores documents from `data`, so API response shapes remain document-like.

## Schema Files

- `backend/db/supabase_low_risk_schema.sql`: `jobs`, `company_boards`.
- `backend/db/supabase_phase2_schema.sql`: `profiles`, `swipes`, `applications`, `browser_submission_runs`.
- `backend/db/supabase_auth_schema.sql`: `users`, `user_sessions`.

## Adapter Mapping

Defined in `backend/db/supabase_adapter.py`.

| Collection | Table | Primary Key |
| --- | --- | --- |
| users | users | user_id |
| user_sessions | user_sessions | session_token |
| profiles | profiles | user_id |
| jobs | jobs | job_id |
| applications | applications | application_id |
| swipes | swipes | swipe_id |
| company_boards | company_boards | board_id |
| browser_submission_runs | browser_submission_runs | run_id |

## users

Purpose: app-level user records created from Supabase Google Auth or dev login.

Top-level columns:

- `user_id text primary key`
- `email text`
- `name text`
- `created_at timestamptz`
- `data jsonb not null default '{}'::jsonb`
- `migrated_at timestamptz not null default now()`

Indexes:

- unique `users_email_idx` on `email` where not null.
- `users_created_at_idx`.
- `users_data_gin_idx`.

Typical document fields:

- `user_id`
- `email`
- `name`
- `picture`
- `created_at`
- `auth_provider`
- Supabase identity metadata where available.

## user_sessions

Purpose: app session tokens consumed by `/api/auth/me`.

Top-level columns:

- `session_token text primary key`
- `user_id text`
- `expires_at timestamptz`
- `created_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- `user_sessions_user_id_idx`
- `user_sessions_expires_at_idx`
- `user_sessions_data_gin_idx`

Typical document fields:

- `session_token`
- `user_id`
- `source`
- `expires_at`
- `created_at`

## profiles

Purpose: user profile, CV data, preferences, application defaults, coach cache.

Top-level columns:

- `user_id text primary key`
- `target_role text`
- `target_location text`
- `updated_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- `profiles_target_role_idx`
- `profiles_data_gin_idx`

Typical document fields:

- `user_id`
- `contact`
- `summary`
- `skills`
- `experience`
- `education`
- `projects`
- `certifications`
- `languages`
- `target_role`
- `target_roles`
- `target_location`
- `target_location_data`
- `remote_preference`
- `seniority`
- `cv_text`
- `cv_original_b64`
- `cv_filename`
- `cv_mime`
- `template_style`
- `application_defaults`
- `application_answers_profile`
- `coach`
- `profile_completion`
- `updated_at`

Notes:

- `/api/profile` excludes `cv_original_b64` from normal responses.
- CV readiness is based on persisted backend profile fields, not only frontend-selected files.

## jobs

Purpose: source of truth for imported jobs.

Top-level columns:

- `job_id text primary key`
- `provider text`
- `external_id text`
- `ats_provider text`
- `auto_apply_supported boolean not null default false`
- `company text`
- `title text`
- `location text`
- `country_code text`
- `remote boolean not null default false`
- `posted_at timestamptz`
- `imported_at timestamptz`
- `last_seen_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- unique `jobs_provider_external_id_idx` on `(provider, external_id)` where both are not null.
- `jobs_ats_auto_apply_idx`.
- `jobs_company_idx`.
- `jobs_country_code_idx`.
- `jobs_imported_at_idx`.
- `jobs_data_gin_idx`.

Typical document fields:

- `job_id`
- `title`
- `company`
- `company_logo`
- `location`
- `country_code`
- `remote`
- `salary_min`
- `salary_max`
- `currency`
- `description`
- `clean_description`
- `job_description_sections`
- `requirements`
- `tech_stack`
- `seniority`
- `posted_at`
- `provider`
- `external_id`
- `provider_job_id`
- `board_token`
- `external_url`
- `apply_url`
- `hosted_url`
- `source`
- `ats_provider`
- `auto_apply_supported`
- `auto_apply_reason`
- `imported_at`
- `last_seen_at`
- `provider_query`
- `provider_search_key`
- `raw_provider_payload` when explicitly enabled

Providers:

- `greenhouse`
- `lever`
- `jsearch`

ATS providers:

- `greenhouse`
- `lever`
- `ashby`
- `unknown`

## company_boards

Purpose: ATS board registry for direct imports.

Top-level columns:

- `board_id text primary key`
- `ats_provider text`
- `company text`
- `board_token text`
- `enabled boolean not null default true`
- `priority integer`
- `last_synced_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- unique `company_boards_ats_board_token_idx`.
- `company_boards_enabled_priority_idx`.
- `company_boards_last_synced_at_idx`.
- `company_boards_data_gin_idx`.

Typical document fields:

- `board_id`
- `company`
- `ats_provider`
- `board_token`
- `board_url`
- `api_url`
- `enabled`
- `priority`
- `countries`
- `role_keywords`
- `last_synced_at`
- `last_success_at`
- `last_error`
- `failure_count`
- `created_at`
- `updated_at`

Current seed boards:

- Greenhouse: stripe, airbnb, discord, figma, reddit, notion, coinbase, scaleai, chime, brex.
- Lever: tsmg, paytmpayments, paytm, shieldai, spotify, coupa, peerspace, dnb, hcvt, bonedry.

## swipes

Purpose: record user job swipes.

Top-level columns:

- `swipe_id text primary key`
- `user_id text`
- `job_id text`
- `direction text`
- `created_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- unique `swipes_user_job_idx` on `(user_id, job_id)` where not null.
- `swipes_user_created_at_idx`.
- `swipes_data_gin_idx`.

Typical document fields:

- `swipe_id`
- `user_id`
- `job_id`
- `direction`
- `created_at`
- job snapshot fields where applicable.

## applications

Purpose: generated application packages and submission status.

Top-level columns:

- `application_id text primary key`
- `user_id text`
- `job_id text`
- `status text`
- `package_status text`
- `submission_status text`
- `created_at timestamptz`
- `updated_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- non-unique `applications_user_job_idx` on `(user_id, job_id)`.
- `applications_user_created_at_idx`.
- `applications_submission_status_idx`.
- `applications_data_gin_idx`.

Important note:

- The schema intentionally dropped unique `(user_id, job_id)` constraints during migration because historical Mongo data could contain multiple application attempts for the same job.
- Runtime writes should still avoid accidental duplicates by reusing existing application records or upserting stable `application_id`.
- The Supabase adapter now writes top-level `user_id` and `job_id` for application rows.

Typical document fields:

- `application_id`
- `user_id`
- `job_id`
- `job`
- `status`
- `match_score`
- `match_reasons`
- `tailored_resume`
- `tailored_resume_structured`
- `tailored_cover_letter`
- `cover_letter`
- `application_answers`
- `tailored_cv_file_b64`
- `tailored_cv_filename`
- `tailored_cv_mime`
- `template_preservation_status`
- `template_preservation_notes`
- `package_status`
- `generation_status`
- `generation_mode`
- `generation_error`
- `submission_status`
- `submitted_at`
- `submission_provider`
- `submission_response_id`
- `submission_error`
- `prepared_application_payload`
- `prepared_generated_answers`
- `prepared_missing_information`
- `prepared_blockers`
- `browser_prepare_result`
- `greenhouse_browser_fill_result`
- `greenhouse_browser_prepared_at`
- `browser_submission_run_id`
- `created_at`
- `updated_at`

Application package statuses:

- `not_generated`
- `generated`
- `generated_text_only`
- `failed`
- `pending_generation`
- `needs_profile_data`
- `needs_job_data`

Submission statuses:

- `not_submitted`
- `ready`
- `prepared`
- `submitted`
- `failed`
- `blocked`
- `action_required`
- `blocked_captcha`
- `prepare_failed`
- `unknown`

## browser_submission_runs

Purpose: store browser automation run results for Lever and Greenhouse.

Top-level columns:

- `run_id text primary key`
- `application_id text`
- `job_id text`
- `user_id text`
- `provider text`
- `status text`
- `dry_run boolean not null default false`
- `created_at timestamptz`
- `data jsonb`
- `migrated_at timestamptz`

Indexes:

- `browser_submission_runs_application_idx`
- `browser_submission_runs_user_created_at_idx`
- `browser_submission_runs_status_idx`
- `browser_submission_runs_data_gin_idx`

Typical document fields:

- `run_id`
- `application_id`
- `job_id`
- `user_id`
- `provider`
- `status`
- `dry_run`
- `screenshots`
- `success_detected`
- `failure_reason`
- `final_url`
- `captcha_required`
- `ready_for_final_click`
- `final_click_candidate_selector`
- `result`
- `created_at`

## Data Access Caveats

- The adapter can push only simple top-level filters to Supabase REST.
- Complex filters, dotted paths, regex, `$or`, and `$and` may cause local filtering after paged reads.
- Hot paths should prefer top-level columns or dedicated repository functions to avoid full-table scans.
- `MAX_READ_ROWS` is 10000 and `READ_PAGE_SIZE` is 1000 in the adapter.
- Adding new frequently queried fields should include:
  - top-level column in SQL
  - `_supabase_row` mapping
  - `TABLE_FILTER_COLUMNS` entry
  - index if needed
