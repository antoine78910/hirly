import asyncio
import inspect
from pathlib import Path

import pytest

import server
from db.supabase_adapter import SupabaseDatabaseAdapter


MIGRATION = Path(__file__).parents[1] / "db/migrations/20260720001800_admin_read_models.sql"
DOWN_MIGRATION = Path(__file__).parents[1] / "db/migrations/20260720001800_admin_read_models.down.sql"
NOW = "2026-07-20T00:00:00+00:00"


class _RpcRecorder:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    async def _python_ingestion_rpc(self, name, payload):
        self.calls.append((name, payload))
        return self.payload


def _cursor(version, rows_key, **extra):
    return {
        "contract_version": version,
        rows_key: [],
        "total": 0,
        "has_previous": False,
        "has_next": False,
        "generated_at": NOW,
        "model_updated_at": NOW,
        "canonical_changed_at": NOW,
        "freshness_lag_seconds": 0,
        "read_model_version": 3,
        **extra,
    }


def test_admin_adapter_calls_exact_versioned_rpcs_once():
    users = _RpcRecorder(_cursor("admin-users-cursor/v3", "users", aggregates={"matching_paying": 0}))
    analytics = _RpcRecorder(_cursor(
        "admin-user-analytics-cursor/v2",
        "users",
        summary={
            "total_users": 0,
            "onboarding_completed": 0,
            "onboarding_in_progress": 0,
            "onboarding_never_started": 0,
            "avg_time_spent_minutes": 0,
            "total_swipes": 0,
            "total_applications": 0,
        },
        onboarding_dropoff={"by_step": [], "never_started": 0, "in_progress": 0, "completed": 0},
        answer_distributions=[],
    ))
    applications = _RpcRecorder(_cursor(
        "admin-applications-cursor/v3",
        "applications",
        filter="submitted",
        queue={"active_count": 0, "items": []},
    ))
    bounds = {
        "limit": 100,
        "cursor_time": None,
        "cursor_id": None,
        "direction": "next",
    }
    asyncio.run(SupabaseDatabaseAdapter.admin_users_cursor(
        users, **bounds, q="alice", paying_only=True,
    ))
    asyncio.run(SupabaseDatabaseAdapter.admin_user_analytics_cursor(
        analytics, **bounds, q=None,
    ))
    asyncio.run(SupabaseDatabaseAdapter.admin_applications_cursor(
        applications, **bounds, status_filter="submitted",
    ))
    assert users.calls == [("admin_users_cursor_v3", {
        "p_limit": 100, "p_cursor_time": None, "p_cursor_id": None,
        "p_direction": "next", "p_q": "alice", "p_paying_only": True,
    })]
    assert analytics.calls == [("admin_user_analytics_cursor_v2", {
        "p_limit": 100, "p_cursor_time": None, "p_cursor_id": None,
        "p_direction": "next", "p_q": None,
    })]
    assert applications.calls == [("admin_applications_cursor_v3", {
        "p_limit": 100, "p_cursor_time": None, "p_cursor_id": None,
        "p_direction": "next", "p_filter": "submitted",
    })]


@pytest.mark.parametrize("payload", [{}, [], {"contract_version": "wrong"}])
def test_admin_adapter_rejects_malformed_contracts(payload):
    with pytest.raises(RuntimeError, match="contract"):
        asyncio.run(SupabaseDatabaseAdapter.admin_users_cursor(
            _RpcRecorder(payload), limit=100, cursor_time=None, cursor_id=None,
            direction="next", q=None, paying_only=False,
        ))


@pytest.mark.parametrize(
    ("limit", "cursor_time", "cursor_id", "direction"),
    [(0, None, None, "next"), (201, None, None, "next"),
     (100, NOW, None, "next"), (100, None, None, "sideways")],
)
def test_admin_adapter_rejects_cursor_bounds_instead_of_clamping(
    limit, cursor_time, cursor_id, direction,
):
    recorder = _RpcRecorder({})
    with pytest.raises(ValueError):
        asyncio.run(SupabaseDatabaseAdapter.admin_users_cursor(
            recorder, limit=limit, cursor_time=cursor_time, cursor_id=cursor_id,
            direction=direction, q=None, paying_only=False,
        ))
    assert recorder.calls == []


def test_admin_adapter_rejects_inconsistent_empty_cursor_metadata():
    empty = _cursor("admin-users-cursor/v3", "users", aggregates={"matching_paying": 0})
    invalid_payloads = [
        {**empty, "aggregates": {"matching_paying": -1}},
        {**empty, "generated_at": "not-a-timestamp"},
        {**empty, "read_model_version": 0},
    ]
    for payload in invalid_payloads:
        with pytest.raises(RuntimeError):
            asyncio.run(SupabaseDatabaseAdapter.admin_users_cursor(
                _RpcRecorder(payload), limit=100, cursor_time=None, cursor_id=None,
                direction="next", q=None, paying_only=False,
            ))


def test_admin_adapter_rejects_partial_analytics_and_invalid_queue_items():
    partial_analytics = _cursor(
        "admin-user-analytics-cursor/v2",
        "users",
        summary={},
        onboarding_dropoff={},
        answer_distributions=[],
    )
    with pytest.raises(RuntimeError):
        asyncio.run(SupabaseDatabaseAdapter.admin_user_analytics_cursor(
            _RpcRecorder(partial_analytics), limit=100, cursor_time=None,
            cursor_id=None, direction="next", q=None,
        ))
    invalid_queue = _cursor(
        "admin-applications-cursor/v3",
        "applications",
        filter="all",
        queue={"active_count": 1, "items": [{"auto_apply_queue_status": "succeeded"}]},
    )
    with pytest.raises(RuntimeError):
        asyncio.run(SupabaseDatabaseAdapter.admin_applications_cursor(
            _RpcRecorder(invalid_queue), limit=100, cursor_time=None,
            cursor_id=None, direction="next", status_filter=None,
        ))


def test_admin_routes_keep_admin_authorization_dependency():
    protected_paths = {
        "/api/admin/users",
        "/api/admin/user-analytics",
        "/api/admin/applications",
    }
    routes = {route.path: route for route in server.api_router.routes if route.path in protected_paths}
    assert routes.keys() == protected_paths
    for path, route in routes.items():
        assert server.require_admin_user in {dependency.call for dependency in route.dependant.dependencies}, path


def test_admin_route_contract_bounds_and_all_history_signature():
    expected = {
        server.admin_list_users: {"limit": 200, "cursor": 2048, "q": 128},
        server.admin_user_analytics: {"limit": 200, "cursor": 2048, "q": 128},
        server.admin_list_applications: {"limit": 200, "cursor": 2048},
    }
    for endpoint, fields in expected.items():
        signature = inspect.signature(endpoint)
        assert "window_days" not in signature.parameters
        assert "page" not in signature.parameters
        for name, maximum in fields.items():
            query = signature.parameters[name].default
            key = "max_length" if name in {"cursor", "q"} else "le"
            assert any(getattr(item, key, None) == maximum for item in query.metadata)


def test_admin_sql_contracts_are_bounded_atomic_and_fail_closed():
    sql = MIGRATION.read_text()
    down = DOWN_MIGRATION.read_text()
    assert "p_window_days" not in sql
    for name, version in (
        ("admin_users_cursor_v3", "admin-users-cursor/v3"),
        ("admin_user_analytics_cursor_v2", "admin-user-analytics-cursor/v2"),
        ("admin_applications_cursor_v3", "admin-applications-cursor/v3"),
    ):
        assert f"FUNCTION public.{name}" in sql
        assert version in sql
        assert f"FUNCTION IF EXISTS public.{name}" in down
    assert " OFFSET " not in sql.upper()
    assert "LIMIT 20" in sql
    assert "bootstrap_state<>'ready'" in sql
    assert "admin_assert_read_model_ready" in sql
    assert sql.count(" TO service_role;") == 3
    assert "admin_user_rm_search_trgm_idx" in sql
    assert "admin_application_scope_count" in sql


def test_cursor_rpcs_never_visit_canonical_fact_relations():
    sql = MIGRATION.read_text()
    cursor_sql = sql.split("CREATE OR REPLACE FUNCTION public.admin_users_cursor_v3", 1)[1]
    cursor_sql = cursor_sql.split("CREATE OR REPLACE FUNCTION public.admin_backfill_applications", 1)[0]
    for canonical in (
        "public.users", "public.profiles", "public.applications",
        "public.swipes", "public.analytics_events",
    ):
        assert canonical not in cursor_sql
    assert "public.admin_user_read_model" in cursor_sql
    assert "public.admin_application_read_model" in cursor_sql
    assert "public.admin_application_scope_count" in cursor_sql


def test_analytics_uses_safe_timestamps_grouped_events_and_bounded_distributions():
    sql = MIGRATION.read_text()
    assert "public.admin_try_timestamptz(s.data->>'updated_at')" in sql
    assert "lag(e.created_at) OVER(PARTITION BY e.user_id" in sql
    assert "SELECT e.user_id,max(e.created_at) last_event" in sql
    assert "row_number() OVER(" in sql
    assert "WHERE c.option_rank<=6" in sql
    assert "public.admin_onboarding_answer_title(answer_key)" in sql


def test_admin_sql_rpcs_validate_cursor_inputs_instead_of_clamping():
    sql = MIGRATION.read_text()
    cursor_sql = sql.split("CREATE OR REPLACE FUNCTION public.admin_users_cursor_v3", 1)[1]
    cursor_sql = cursor_sql.split("CREATE OR REPLACE FUNCTION public.admin_backfill_applications", 1)[0]
    assert "LEAST(GREATEST(COALESCE(p_limit" not in cursor_sql
    assert cursor_sql.count("MESSAGE='invalid admin cursor input'") == 2
    assert "f IS NOT NULL AND f NOT IN" in cursor_sql


def test_scale_harness_uses_transparent_read_model_plans():
    harness = (Path(__file__).parent / "run_admin_read_model_scale_harness.py").read_text()
    assert "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)" in harness
    assert '"expected_matrix_cells": 66' in harness
    assert "admin_user_read_model" in harness
    assert "admin_application_read_model" in harness
