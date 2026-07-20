import asyncio
import inspect
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

import server
from db.supabase_adapter import SupabaseDatabaseAdapter


AGGREGATE_RESPONSE_LIMIT = 512 * 1024
LIST_RESPONSE_LIMIT = 2 * 1024 * 1024
MAX_PAGE_SIZE = 500
MAX_WINDOW_DAYS = 365
MIGRATION = Path(__file__).parents[1] / "db/migrations/20260720001600_admin_bounded_contracts.sql"
DOWN_MIGRATION = Path(__file__).parents[1] / "db/migrations/20260720001600_admin_bounded_contracts.down.sql"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_size(payload) -> int:
    return len(json.dumps(payload, separators=(",", ":"), default=str).encode())


def _assert_current_generated_at(payload, *, max_age_seconds: float) -> None:
    generated_at = datetime.fromisoformat(str(payload["generated_at"]).replace("Z", "+00:00"))
    assert generated_at.tzinfo is not None
    age = (datetime.now(timezone.utc) - generated_at.astimezone(timezone.utc)).total_seconds()
    assert 0 <= age <= max_age_seconds


class _BoundedAdminDb:
    def __init__(self):
        self.calls = []

    async def admin_overview_snapshot(self):
        self.calls.append(("overview", {}))
        return {"metrics": {}, "top_blockers": [], "latest_attention": [], "generated_at": _utc_now()}

    async def admin_analytics_snapshot(self, window_days):
        self.calls.append(("analytics", {"window_days": window_days}))
        return {"metrics": {}, "generated_at": _utc_now(), "window_days": window_days}

    async def admin_users_page(self, **kwargs):
        self.calls.append(("users", kwargs))
        return {"users": [], "generated_at": _utc_now(), **kwargs}

    async def admin_applications_page(self, **kwargs):
        self.calls.append(("applications", kwargs))
        return {"applications": [], "generated_at": _utc_now(), **kwargs}


def test_admin_routes_use_one_bounded_operation_and_emit_fresh_small_payloads(monkeypatch):
    bounded_db = _BoundedAdminDb()
    monkeypatch.setattr(server, "db", bounded_db)
    monkeypatch.setenv("ADMIN_BOUNDED_RPC_ENABLED", "true")
    admin = server.User(user_id="admin", email="admin@example.com", name="Admin")

    overview = asyncio.run(server.admin_overview(admin))
    analytics = asyncio.run(server.admin_analytics(30, admin))
    users = asyncio.run(server.admin_list_users(2, 100, 30, admin))
    applications = asyncio.run(server.admin_list_applications(None, None, 2, 100, 30, admin))

    assert bounded_db.calls == [
        ("overview", {}),
        ("analytics", {"window_days": 30}),
        ("users", {"page": 2, "page_size": 100, "window_days": 30}),
        (
            "applications",
            {"page": 2, "page_size": 100, "window_days": 30, "status_filter": None},
        ),
    ]
    assert _json_size(overview) <= AGGREGATE_RESPONSE_LIMIT
    assert _json_size(analytics) <= AGGREGATE_RESPONSE_LIMIT
    assert _json_size(users) <= LIST_RESPONSE_LIMIT
    assert _json_size(applications) <= LIST_RESPONSE_LIMIT
    for payload in (overview, analytics):
        _assert_current_generated_at(payload, max_age_seconds=300)
    for payload in (users, applications):
        _assert_current_generated_at(payload, max_age_seconds=5)


def test_admin_routes_keep_admin_authorization_dependency():
    protected_paths = {
        "/api/admin/overview",
        "/api/admin/analytics",
        "/api/admin/users",
        "/api/admin/applications",
    }
    routes = {route.path: route for route in server.api_router.routes if route.path in protected_paths}
    assert routes.keys() == protected_paths
    for path, route in routes.items():
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        assert server.require_admin_user in dependency_calls, path


class _RpcRecorder:
    def __init__(self):
        self.calls = []

    async def _python_ingestion_rpc(self, name, payload):
        self.calls.append((name, payload))
        return {}


def test_admin_adapter_clamps_page_and_window_inputs_before_rpc():
    recorder = _RpcRecorder()
    asyncio.run(
        SupabaseDatabaseAdapter.admin_users_page(
            recorder,
            page=0,
            page_size=50_000,
            window_days=50_000,
        )
    )
    asyncio.run(
        SupabaseDatabaseAdapter.admin_applications_page(
            recorder,
            page=2,
            page_size=50_000,
            window_days=50_000,
            status_filter="submitted",
        )
    )

    assert recorder.calls == [
        (
            "admin_users_page",
            {"p_limit": MAX_PAGE_SIZE, "p_offset": 0, "p_window_days": MAX_WINDOW_DAYS},
        ),
        (
            "admin_applications_page",
            {
                "p_limit": MAX_PAGE_SIZE,
                "p_offset": MAX_PAGE_SIZE,
                "p_window_days": MAX_WINDOW_DAYS,
                "p_status": "submitted",
            },
        ),
    ]


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def limit(self, _limit):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class _EmptyCollection:
    table_name = "applications"

    def find(self, *_args):
        return _Cursor([])


class _BrokenCollection:
    table_name = "applications"

    def find(self, *_args):
        raise RuntimeError("database unavailable")


def test_admin_database_error_is_distinct_from_genuine_empty():
    assert asyncio.run(server._admin_safe_find(_EmptyCollection())) == []
    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server._admin_safe_find(_BrokenCollection()))
    assert exc.value.status_code == 503
    assert "applications" in str(exc.value.detail)


def _function_sql(sql: str, name: str) -> str:
    match = re.search(
        rf"CREATE OR REPLACE FUNCTION public\.{name}\b(?P<body>.*?)(?=\nCREATE OR REPLACE FUNCTION|\nDO \$\$)",
        sql,
        re.DOTALL,
    )
    assert match, name
    return match.group("body")


def _left_width(sql: str, expression: str) -> int:
    match = re.search(
        rf"left\(\s*{re.escape(expression)}(?:\s*::\s*text)?\s*,\s*(\d+)\s*\)",
        sql,
        re.IGNORECASE,
    )
    assert match, f"{expression} must have an explicit response-width bound"
    return int(match.group(1))


def test_admin_sql_contracts_bound_rows_windows_payload_widths_and_privileges():
    sql = MIGRATION.read_text()
    down = DOWN_MIGRATION.read_text()
    overview_sql = _function_sql(sql, "admin_overview_snapshot")
    analytics_sql = _function_sql(sql, "admin_analytics_snapshot")
    users_sql = _function_sql(sql, "admin_users_page")
    applications_sql = _function_sql(sql, "admin_applications_page")

    for function_sql in (overview_sql, analytics_sql, users_sql, applications_sql):
        assert "SECURITY DEFINER" in function_sql
        assert "SET search_path = public, pg_temp" in function_sql
        assert "SET statement_timeout = '10s'" in function_sql
        assert "'generated_at'" in function_sql
    assert "LEAST(GREATEST(COALESCE(p_limit,100),1),500)" in users_sql
    assert "LEAST(GREATEST(COALESCE(p_limit,100),1),500)" in applications_sql
    window_bound = r"LEAST\(\s*COALESCE\(\s*p_window_days\s*,\s*30\s*\)\s*,\s*365\s*\)"
    assert re.search(window_bound, analytics_sql)
    assert re.search(window_bound, users_sql)
    assert re.search(window_bound, applications_sql)

    compact_forbidden = (
        "cv_",
        "source_document",
        "description",
        "cover_letter",
        "tailored_resume",
        "data->",
    )
    for function_sql in (users_sql, applications_sql):
        lowered = function_sql.lower()
        assert not any(field in lowered for field in compact_forbidden)

    user_widths = {
        "user_id": _left_width(users_sql, "u.user_id"),
        "email": _left_width(users_sql, "u.email"),
        "name": _left_width(users_sql, "u.name"),
    }
    application_widths = {
        "application_id": _left_width(applications_sql, "a.application_id"),
        "user_id": _left_width(applications_sql, "a.user_id"),
        "user_email": _left_width(applications_sql, "u.email"),
        "job_id": _left_width(applications_sql, "a.job_id"),
        "company": _left_width(applications_sql, "j.company"),
        "title": _left_width(applications_sql, "j.title"),
        "ats_provider": _left_width(applications_sql, "j.ats_provider"),
        "submission_status": _left_width(applications_sql, "a.submission_status"),
        "package_status": _left_width(applications_sql, "a.package_status"),
        "status": _left_width(applications_sql, "a.status"),
    }
    user_row = {field: "x" * width for field, width in user_widths.items()}
    user_row.update(total_applications=1_000_000, total_swipes=1_000_000, created_at=_utc_now())
    application_row = {field: "x" * width for field, width in application_widths.items()}
    application_row.update(created_at=_utc_now(), updated_at=_utc_now(), submitted_at=_utc_now())
    assert _json_size({"users": [user_row] * MAX_PAGE_SIZE, "generated_at": _utc_now()}) <= LIST_RESPONSE_LIMIT
    assert (
        _json_size({"applications": [application_row] * MAX_PAGE_SIZE, "generated_at": _utc_now()})
        <= LIST_RESPONSE_LIMIT
    )

    assert "REVOKE ALL" in sql
    assert "FROM anon" in sql
    assert "FROM authenticated" in sql
    assert "TO service_role" in sql
    for name in (
        "admin_overview_snapshot",
        "admin_analytics_snapshot",
        "admin_users_page",
        "admin_applications_page",
    ):
        assert f"DROP FUNCTION IF EXISTS public.{name}" in down


def test_admin_route_defaults_and_maxima_are_declared_in_fastapi_contract():
    expected = {
        server.admin_analytics: {"window_days": (30, 365)},
        server.admin_list_users: {"page_size": (100, 500), "window_days": (30, 365)},
        server.admin_list_applications: {"page_size": (100, 500), "window_days": (30, 365)},
    }
    for endpoint, parameters in expected.items():
        signature = inspect.signature(endpoint)
        for name, (default, maximum) in parameters.items():
            query = signature.parameters[name].default
            assert query.default == default
            assert any(getattr(item, "le", None) == maximum for item in query.metadata)
