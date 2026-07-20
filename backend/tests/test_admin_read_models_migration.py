from pathlib import Path


ROOT = Path(__file__).parents[1]
UP = ROOT / "db/migrations/20260720001800_admin_read_models.sql"
DOWN = ROOT / "db/migrations/20260720001800_admin_read_models.down.sql"
SEMANTIC_FIXTURE = ROOT / "tests/sql/admin_read_model_semantic_parity_fixture.sql"
SERVER = ROOT / "server.py"


def test_rejected_direct_aggregation_migration_is_replaced():
    assert UP.exists()
    assert DOWN.exists()
    assert not (UP.parent / "20260720001800_admin_table_server_pagination.sql").exists()
    sql = UP.read_text()
    assert " OFFSET " not in sql.upper()
    assert "total_pages" not in sql
    assert "admin_users_page_v2" not in sql
    assert "admin_applications_page_v2" not in sql


def test_exact_read_models_indexes_and_cursor_rpcs_are_declared():
    sql = UP.read_text()
    for token in (
        "CREATE TABLE public.admin_user_read_model",
        "CREATE TABLE public.admin_onboarding_answer_fact",
        "CREATE TABLE public.admin_application_read_model",
        "CREATE TABLE public.admin_application_scope_count",
        "CREATE TABLE public.admin_read_model_state",
        "admin_user_rm_search_trgm_idx",
        "admin_app_rm_queue_idx",
        "admin_users_cursor_v3",
        "admin_user_analytics_cursor_v2",
        "admin_applications_cursor_v3",
        "'aggregates',jsonb_build_object('matching_paying'",
        "'model_updated_at'",
        "'canonical_changed_at'",
        "'freshness_lag_seconds'",
        "'onboarding_dropoff'",
        "'applications',COALESCE((SELECT jsonb_agg(to_jsonb(ordered))",
    ):
        assert token in sql


def test_projection_is_transactional_and_uses_cast_helpers():
    sql = UP.read_text()
    assert "CREATE TRIGGER admin_applications_project" in sql
    assert "REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows" in sql
    assert "SKIP LOCKED" in sql
    assert "admin_try_timestamptz" in sql
    assert "invalid_datetime_format OR datetime_field_overflow" in sql
    assert "hashtextextended" in sql
    assert "9223372036854775807" in sql
    assert "LEFT JOIN public.jobs" not in sql
    assert "CREATE TRIGGER admin_jobs_project" not in sql
    assert "NULLIF(d->>'company','')" in sql
    assert "NULLIF(d->>'title','')" in sql
    assert "d->'tailored_resume_structured' NOT IN" in sql
    assert "d->'tailored_resume' NOT IN" in sql


def test_reconciliation_is_exact_across_facts_shards_queue_answers_and_hashes():
    sql = UP.read_text()
    reconcile = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_reconcile_read_models",
        maxsplit=1,
    )[1]
    for token in (
        "v_user_fact_mismatches",
        "generate_series(0,63)",
        "v_scope_shard_mismatches",
        "scope_key='queue_active'",
        "expected_answers",
        "v_answer_mismatches",
        "application_semantic_hash",
        "user_semantic_hash",
        "semantic_hashes_match",
        "admin reconciliation semantic probe rollback",
    ):
        assert token in reconcile
    assert "ok:=cu=mu AND ca=ma AND cc=mc AND v_user_fact_mismatches=0" in reconcile


def test_application_backfill_uses_durable_missing_rows_not_external_cursors():
    sql = UP.read_text()
    applications = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_backfill_applications", 1
    )[1].split("CREATE OR REPLACE FUNCTION public.admin_backfill_users", 1)[0]

    assert "LEFT JOIN public.admin_application_read_model" in applications
    assert "WHERE r.application_id IS NULL" in applications
    assert "application_id>p_after_application_id" not in applications
    assert "FOR UPDATE OF a SKIP LOCKED" in applications
    assert "set_config('hirly.admin_backfill','on',true)" in applications
    assert "admin_rebuild_application_scope_counts()" in applications
    assert "application_facts_generation=GREATEST(application_facts_generation,1)" in applications
    assert "admin_rebuild_users(affected_user_ids)" not in applications
    assert "'cursor_ignored',p_after_application_id IS NOT NULL" in applications
    assert "current_setting('hirly.admin_backfill',true)='on'" in sql


def test_user_fact_finalization_is_generation_fenced_and_bounded():
    sql = UP.read_text()
    users = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_backfill_users", 1
    )[1].split("CREATE OR REPLACE FUNCTION public.admin_reconcile_read_models", 1)[0]
    assert "r.application_facts_generation<target_generation" in users
    assert "LIMIT LEAST(GREATEST(COALESCE(p_limit,500),1),500)" in users
    assert "FOR UPDATE OF u SKIP LOCKED" in users
    assert "SET application_facts_generation=target_generation" in users
    assert "v_stale_user_application_facts" in sql
    assert "SET statement_timeout='10min'" in sql

def test_semantic_parity_helpers_and_hostile_fixture_cover_review_boundaries():
    sql = UP.read_text()
    fixture = SEMANTIC_FIXTURE.read_text()
    for token in (
        "admin_onboarding_step_label",
        "admin_onboarding_answer_title",
        "admin_onboarding_answer_label",
        "admin_onboarding_answers",
        "admin_normalize_missing_information",
        "WHERE c.option_rank<=6",
        "drop_off_step IS NOT NULL",
    ):
        assert token in sql
    for token in (
        "top-six/title/tie semantic parity failed",
        "onboarding terminal/label semantic parity failed",
        "onboarding fallback semantic parity failed",
        "missing-information normalization/deduplication parity failed",
    ):
        assert token in fixture


def test_every_canonical_projection_path_advances_a_synchronous_watermark():
    sql = UP.read_text()
    marker = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_mark_canonical_change",
        maxsplit=1,
    )[1].split("CREATE OR REPLACE FUNCTION public.admin_application_row_project", maxsplit=1)[0]
    assert "CREATE TABLE public.admin_read_model_watermark" in sql
    assert "PRIMARY KEY(source_key,bucket)" in sql
    assert "bucket BETWEEN 0 AND 131071" in sql
    assert "EXCEPTION WHEN lock_not_available" in marker
    assert "v_overflow_bucket" in marker
    assert "canonical_changed_at=EXCLUDED.canonical_changed_at" in marker
    assert "model_changed_at=EXCLUDED.model_changed_at" in marker
    assert sql.count("PERFORM public.admin_mark_canonical_change(") == 2
    transition = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_rebuild_users_transition",
        maxsplit=1,
    )[1].split("CREATE TRIGGER admin_applications_users_insert", maxsplit=1)[0]
    assert "PERFORM public.admin_mark_canonical_change(TG_TABLE_NAME" in transition
    for trigger in (
        "admin_swipes_users_insert",
        "admin_events_users_insert",
        "admin_users_rebuild_insert",
        "admin_profiles_rebuild_insert",
    ):
        assert f"CREATE TRIGGER {trigger}" in sql


def test_application_user_facts_use_a_lock_safe_bounded_refresh():
    sql = UP.read_text()
    refresh = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_refresh_user_application_facts_transition",
        maxsplit=1,
    )[1].split("CREATE TRIGGER admin_applications_users_insert", maxsplit=1)[0]
    assert "ORDER BY user_id FOR UPDATE" in refresh
    assert "total_applications=r.total_applications+d.delta" in refresh
    assert "count(a.application_id) total_applications" in refresh
    assert "max(a.sort_at) last_application_at" in refresh
    for operation in ("insert", "update", "delete"):
        trigger = sql.split(
            f"CREATE TRIGGER admin_applications_users_{operation}",
            maxsplit=1,
        )[1].split(";", maxsplit=1)[0]
        assert "admin_refresh_user_application_facts_transition" in trigger


def test_readiness_requires_two_clean_reconciliations_with_an_intervening_write():
    sql = UP.read_text()
    reconcile = sql.split(
        "CREATE OR REPLACE FUNCTION public.admin_reconcile_read_models(", 1
    )[1].split("ALTER TABLE public.admin_user_read_model", 1)[0]

    for state_field in (
        "first_clean_reconciled_at",
        "first_clean_canonical_change_at",
        "clean_reconciliation_count",
    ):
        assert state_field in sql
    assert "WHERE singleton FOR UPDATE" in reconcile
    assert "WHEN p_mark_ready AND ok AND next_clean_count=2 THEN 'ready'" in reconcile
    assert "COALESCE(v_state.last_canonical_change_at,'-infinity')>" in reconcile
    assert "'intervening_normal_write',has_intervening_write" in reconcile
    assert "max(w.canonical_changed_at)" in reconcile
    assert "last_canonical_change_at=v_state.last_canonical_change_at" in reconcile


def test_application_writers_persist_split_safe_display_snapshots():
    server = SERVER.read_text()
    generated = server.split("def _build_generated_application_doc(", 1)[1].split(
        "def _pending_application_doc(", 1
    )[0]
    pending = server.split("def _pending_application_doc(", 1)[1].split(
        "def _normalize_application_status_fields(", 1
    )[0]
    direct_submit = server.split(
        "async def _load_or_create_agent_application(", 1
    )[1].split(
        "@api_router.post(\"/applications/greenhouse/prepare-submit\")", 1
    )[0]

    for writer in (generated, pending, direct_submit):
        assert '"company": job.get("company")' in writer
        assert '"title": job.get("title")' in writer
        assert '"ats_provider": job.get("ats_provider")' in writer


def test_projection_reads_json_authoritative_canonical_contracts():
    sql = UP.read_text()
    for forbidden in (
        "a.submission_status",
        "a.package_status",
        "a.created_at",
        "a.updated_at",
        "u.name",
        "u.created_at",
        "u.updated_at",
        "p.updated_at",
        "s.direction",
        "s.created_at",
    ):
        assert forbidden not in sql
    for required in (
        "u.data->>'name'",
        "u.data->>'created_at'",
        "s.data->>'direction'",
        "s.data->>'created_at'",
        "user_data#>>'{billing,credits_total}'",
        "user_data#>>'{billing,referral_bonus_credits_total}'",
        "sessions_count,time_spent_minutes",
        "onboarding_started_at,onboarding_completed_at",
    ):
        assert required in sql


def test_security_is_fail_closed_and_only_cursor_rpcs_are_granted():
    sql = UP.read_text()
    for table in (
        "admin_user_read_model",
        "admin_onboarding_answer_fact",
        "admin_application_read_model",
        "admin_application_scope_count",
        "admin_read_model_state",
        "admin_read_model_watermark",
    ):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in sql
    assert sql.count(" TO service_role;") == 3
    assert "ARRAY['anon','authenticated']" in sql
    assert "ARRAY['anon','authenticated','service_role']" not in sql
    assert "bootstrap_state<>'ready'" in sql
    assert "SET search_path=pg_catalog,public" in sql


def test_down_drops_derived_objects_without_touching_canonical_tables():
    down = DOWN.read_text()
    assert "refusing admin read-model down migration" in down
    assert "DROP TABLE IF EXISTS public.admin_application_read_model" in down
    for canonical in ("users", "profiles", "applications", "swipes", "analytics_events"):
        assert f"DROP TABLE IF EXISTS public.{canonical}" not in down
