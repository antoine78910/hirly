from pathlib import Path


ROOT = Path(__file__).parents[1]
MIGRATIONS = ROOT / "db" / "migrations"
ORDERED = [
    "20260720001100_auth_session_lookup.sql",
    "20260720001200_onboarding_profile_patch.sql",
    "20260720001300_application_tracker_contracts.sql",
    "20260720001350_notification_mark_all.sql",
    "20260720001400_auto_apply_backfill.sql",
    "20260720001500_gmail_outcome_batch.sql",
    "20260720001600_admin_bounded_contracts.sql",
    "20260720001700_service_only_rls.sql",
    "20260721002600_auto_apply_queue_claim_index.sql",
    "20260721002700_auto_apply_queue_claim_rpc.sql",
]


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text()


def test_application_migration_versions_are_unique_and_have_reverse_scripts():
    versions = [name.split("_", 1)[0] for name in ORDERED]
    assert len(versions) == len(set(versions))
    assert ORDERED == sorted(ORDERED)
    for name in ORDERED:
        assert (MIGRATIONS / name).is_file()
        assert (MIGRATIONS / name.replace(".sql", ".down.sql")).is_file()


def test_promoted_column_backfills_are_cursor_bounded_and_indexes_are_online():
    auth = _sql(ORDERED[0])
    tracker = _sql(ORDERED[2])

    assert "UPDATE public.users\nSET data = data" not in auth
    assert "UPDATE public.applications SET data = data" not in tracker
    for sql, function in (
        (auth, "backfill_user_promoted_auth_fields"),
        (tracker, "backfill_application_tracker_columns"),
    ):
        assert function in sql
        assert "FOR UPDATE SKIP LOCKED" in sql
        assert "SET lock_timeout = '1s'" in sql
        assert "1000" in sql
    assert auth.count("INDEX CONCURRENTLY") >= 2
    assert tracker.count("INDEX CONCURRENTLY") >= 2


def test_mutation_contracts_are_bounded_concurrency_safe_and_fail_closed():
    notifications = _sql(ORDERED[3])
    auto_apply = _sql(ORDERED[4])
    gmail = _sql(ORDERED[5])

    assert "ORDER BY notification_id" in notifications
    assert "FOR UPDATE SKIP LOCKED" in notifications
    assert "::boolean" not in notifications
    assert "FOR UPDATE OF a SKIP LOCKED" in auto_apply
    assert "ORDER BY a.created_at NULLS LAST, a.application_id" in auto_apply
    assert "ARRAY[]::text[]" in auto_apply
    assert "jsonb_array_length(p_updates) > 100" in gmail
    assert "HAVING count(*) > 1" in gmail
    assert "array_position(" in gmail
    assert "left(row.subject, 998)" in gmail
    assert "left(row.sender, 320)" in gmail


def test_null_batch_inputs_remain_bounded_or_fail_closed():
    notifications = _sql(ORDERED[3])
    auto_apply = _sql(ORDERED[4])
    gmail = _sql(ORDERED[5])

    assert "GREATEST(COALESCE(p_limit, 500), 1)" in notifications
    assert "GREATEST(COALESCE(p_limit, 200), 1)" in auto_apply
    assert "p_updates IS NULL" in gmail


def test_security_definers_pin_catalog_and_gate_role_grants():
    for name in ORDERED:
        sql = _sql(name)
        if "SECURITY DEFINER" not in sql:
            continue
        assert "SET search_path = pg_catalog, public" in sql
        assert "REVOKE ALL ON FUNCTION" in sql
        assert "rolname = 'service_role'" in sql


def test_tracker_rollback_preserves_additive_evidence_columns():
    down = _sql("20260720001300_application_tracker_contracts.down.sql")
    assert "DROP COLUMN IF EXISTS" not in down
    assert "DROP INDEX CONCURRENTLY" in down
    assert "intentionally retained" in down


def test_service_only_tables_enable_non_forced_policyless_rls():
    up = _sql("20260720001700_service_only_rls.sql")
    down = _sql("20260720001700_service_only_rls.down.sql")
    for table in (
        "browser_submission_runs",
        "notifications",
        "creator_applications",
    ):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in up
        assert f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY" in down
    assert "FORCE ROW LEVEL SECURITY" not in up
    assert "CREATE POLICY" not in up
    assert "REVOKE" not in up


def test_auto_apply_claim_contract_is_atomic_bounded_and_service_role_only():
    index = _sql("20260721002600_auto_apply_queue_claim_index.sql")
    rpc = _sql("20260721002700_auto_apply_queue_claim_rpc.sql")
    index_order = """(data ->> 'auto_apply_queued_at') ASC NULLS LAST,\n  created_at ASC NULLS LAST,\n  application_id ASC"""
    rpc_order = """a.data ->> 'auto_apply_queued_at' ASC NULLS LAST,\n      a.created_at ASC NULLS LAST,\n      a.application_id ASC"""

    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS" in index
    assert index_order in index
    assert "WHERE data ->> 'auto_apply_queue_status' = 'queued'" in index
    assert "BEGIN;" not in index
    assert rpc.startswith("BEGIN;") and rpc.rstrip().endswith("COMMIT;")
    assert "RETURNS jsonb" in rpc
    assert "SECURITY DEFINER" in rpc
    assert "SET search_path = pg_catalog, public" in rpc
    assert "SET statement_timeout = '2s'" in rpc
    assert "SET lock_timeout = '1s'" in rpc
    assert "FOR UPDATE SKIP LOCKED" in rpc
    assert "LIMIT 1" in rpc
    assert rpc_order in rpc
    assert rpc.count("data ->> 'auto_apply_queue_status' = 'queued'") >= 2
    assert "updated_at = clock.claimed_at" in rpc
    assert "RETURNING a.data, a.application_id, a.user_id, a.job_id" in rpc
    assert "updated.data || jsonb_build_object" in rpc
    assert "aclexplode(" in rpc and "acl.grantee NOT IN" in rpc
    assert "FROM PUBLIC" in rpc and "FROM anon" in rpc and "FROM authenticated" in rpc
    assert "TO service_role" in rpc
    assert "CREATE INDEX CONCURRENTLY" not in rpc

    assert _sql("20260721002700_auto_apply_queue_claim_rpc.down.sql").find(
        "DROP FUNCTION IF EXISTS public.claim_auto_apply_queue()"
    ) >= 0
    assert _sql("20260721002600_auto_apply_queue_claim_index.down.sql").strip() == (
        "DROP INDEX CONCURRENTLY IF EXISTS public.applications_auto_apply_queue_claim_idx;"
    )
